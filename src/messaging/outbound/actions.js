"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * ChannelMessageActionAdapter for the Lark/Feishu channel plugin.
 *
 * Implements the standard message-action interface so the framework's
 * built-in `message` tool can route send, react, delete and other
 * actions to Feishu.
 *
 * The `send` action is the unified entry-point for text, card, media,
 * reply and attachment delivery — matching the Telegram/Discord pattern
 * where a single action handles all outbound message types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feishuMessageActions = void 0;
const tool_send_1 = require("openclaw/plugin-sdk/tool-send");
const param_readers_1 = require("openclaw/plugin-sdk/param-readers");
const typebox_1 = require("@sinclair/typebox");
const sdk_compat_1 = require("../../core/sdk-compat.js");
const lark_client_1 = require("../../core/lark-client.js");
const accounts_1 = require("../../core/accounts.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const reactions_1 = require("./reactions.js");
const pins_1 = require("./pins.js");
const deliver_1 = require("./deliver.js");
const media_1 = require("./media.js");
const multi_image_mode_1 = require("./multi-image-mode.js");
const log = (0, lark_logger_1.larkLogger)('outbound/actions');
const FEISHU_SEND_TEXT_DESCRIPTION = 'Text to send as a separate Feishu message. During a normal Feishu streaming-card reply, do not call send just to repeat or finalize the same answer; return the final answer normally so the active card can be completed by the reply dispatcher. Use send only when the user explicitly needs an additional separate message.';
const FEISHU_MESSAGE_TOOL_SCHEMA = {
    properties: {
        message: typebox_1.Type.Optional(typebox_1.Type.String({ description: FEISHU_SEND_TEXT_DESCRIPTION })),
        text: typebox_1.Type.Optional(typebox_1.Type.String({ description: FEISHU_SEND_TEXT_DESCRIPTION })),
    },
    visibility: 'current-channel',
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Assert that a Lark SDK response has code === 0 (or no code field). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertLarkOk(res, context) {
    const code = res?.code;
    if (code !== undefined && code !== 0) {
        const msg = res?.msg ?? 'unknown error';
        throw new Error(`[feishu-actions] ${context}: code=${code}, msg=${msg}`);
    }
}
// ---------------------------------------------------------------------------
// Supported actions
// ---------------------------------------------------------------------------
const SUPPORTED_ACTIONS = new Set([
    'send',
    'react',
    'reactions',
    'delete',
    'unsend',
    'pin',
    'unpin',
    'list-pins',
    // "member-info",
]);
// ---------------------------------------------------------------------------
// Send param extraction
// ---------------------------------------------------------------------------
/** Try to resolve a card param to a plain object. Accepts objects directly or JSON strings. */
function parseCardParam(raw) {
    if (raw == null)
        return undefined;
    // Already a non-array object — use directly (empty {} is never a valid card).
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        const obj = raw;
        if (Object.keys(obj).length === 0)
            return undefined;
        return obj;
    }
    // String — attempt JSON.parse.
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
            log.warn('params.card is a string but not a JSON object, ignoring');
            return undefined;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'object' && parsed != null && !Array.isArray(parsed)) {
                log.info('params.card was a JSON string, parsed successfully');
                return parsed;
            }
            log.warn('params.card JSON parsed but is not a plain object, ignoring');
            return undefined;
        }
        catch {
            log.warn('params.card is a string but failed to JSON.parse, ignoring');
            return undefined;
        }
    }
    // Other types (number, boolean, etc.) — ignore with warning.
    log.warn(`params.card has unexpected type "${typeof raw}", ignoring`);
    return undefined;
}
/**
 * Extract and normalise all send-related parameters from the raw action params.
 * When `toolContext` is provided, thread context is inherited so that replies
 * are routed to the correct thread.
 */
function readFeishuSendParams(params, toolContext) {
    const to = (0, param_readers_1.readStringParam)(params, 'to') ?? '';
    const text = (0, param_readers_1.readStringParam)(params, 'message', { allowEmpty: true }) ??
        (0, param_readers_1.readStringParam)(params, 'text', { allowEmpty: true }) ??
        '';
    const mediaUrl = (0, param_readers_1.readStringParam)(params, 'media') ??
        (0, param_readers_1.readStringParam)(params, 'path') ??
        (0, param_readers_1.readStringParam)(params, 'filePath') ??
        (0, param_readers_1.readStringParam)(params, 'url');
    // Framework-level media list: the message tool always sets `mediaUrls`
    // (attachments + MEDIA directives merged). Honour the full array so
    // multi-image sends can be merged into one post instead of dropping
    // everything after the first item.
    const mediaUrls = Array.isArray(params.mediaUrls)
        ? params.mediaUrls.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
        : [];
    const fileName = (0, param_readers_1.readStringParam)(params, 'fileName') ?? (0, param_readers_1.readStringParam)(params, 'name');
    // Thread routing: when targeting the current chat (or unspecified),
    // inherit thread context from SDK toolContext.
    const sameChat = !to || to === toolContext?.currentChannelId;
    const replyInThread = sameChat && Boolean(toolContext?.currentThreadTs);
    const replyToMessageId = (0, param_readers_1.readStringParam)(params, 'replyTo') ??
        (replyInThread && toolContext?.currentMessageId ? String(toolContext.currentMessageId) : undefined);
    const card = parseCardParam(params.card);
    return {
        to,
        text,
        mediaUrl: mediaUrl ?? undefined,
        mediaUrls,
        fileName: fileName ?? undefined,
        replyToMessageId: replyToMessageId ?? undefined,
        replyInThread,
        card,
    };
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
exports.feishuMessageActions = {
    describeMessageTool: ({ cfg }) => {
        const accounts = (0, accounts_1.getEnabledLarkAccounts)(cfg);
        if (accounts.length === 0) {
            return { actions: [], capabilities: [], schema: null };
        }
        return {
            actions: Array.from(SUPPORTED_ACTIONS),
            capabilities: ['cards'],
            schema: FEISHU_MESSAGE_TOOL_SCHEMA,
        };
    },
    supportsAction: ({ action }) => SUPPORTED_ACTIONS.has(action),
    extractToolSend: ({ args }) => (0, tool_send_1.extractToolSend)(args, 'sendMessage'),
    handleAction: async (ctx) => {
        const { action, params, cfg, accountId, toolContext } = ctx;
        const aid = accountId ?? undefined;
        log.info(`handleAction: action=${action}, accountId=${aid ?? 'default'}`);
        try {
            switch (action) {
                case 'send':
                    return await deliverMessage(cfg, readFeishuSendParams(params, toolContext), aid, ctx.mediaLocalRoots);
                case 'react':
                    return await handleReact(cfg, params, aid);
                case 'reactions':
                    return await handleReactions(cfg, params, aid);
                case 'delete':
                case 'unsend':
                    return await handleDelete(cfg, params, aid);
                case 'pin':
                    return await handlePin(cfg, params, aid);
                case 'unpin':
                    return await handleUnpin(cfg, params, aid);
                case 'list-pins':
                    return await handleListPins(cfg, params, aid, toolContext);
                default:
                    throw new Error(`Action "${action}" is not supported for Feishu. ` +
                        `Supported actions: ${Array.from(SUPPORTED_ACTIONS).join(', ')}.`);
            }
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`handleAction failed: action=${action}, error=${errMsg}`);
            throw err;
        }
    },
};
// ---------------------------------------------------------------------------
// Unified message delivery
// ---------------------------------------------------------------------------
/**
 * Unified message delivery — handles text, card, and media payloads with
 * optional reply-to and thread routing.
 *
 * Supports `fileName` for named file uploads via `uploadAndSendMediaLark`.
 * On media upload failure, falls back to sending the URL as a text link.
 */
async function deliverMessage(cfg, sp, accountId, mediaLocalRoots) {
    const { to, text, fileName, replyToMessageId, replyInThread, card } = sp;
    const mediaList = sp.mediaUrls?.length ? sp.mediaUrls : sp.mediaUrl ? [sp.mediaUrl] : [];
    const hasMedia = mediaList.length > 0;
    const payloadType = card ? 'card' : hasMedia ? 'media' : 'text';
    const target = to || replyToMessageId || 'unknown';
    log.info(`deliverMessage: type=${payloadType}, target=${target}, ` +
        `isReply=${Boolean(replyToMessageId)}, replyInThread=${replyInThread}, ` +
        `textLen=${text.trim().length}, mediaCount=${mediaList.length}, ` +
        `fileName=${fileName ?? '(none)'}`);
    if (!text.trim() && !card && !hasMedia) {
        log.warn('deliverMessage: no payload, rejecting');
        throw new Error('send requires at least one of: message, card, or media.');
    }
    const sendCtx = { cfg, to, replyToMessageId, replyInThread, accountId };
    // Send text first if both text and card/media are present.
    if (text.trim() && (card || hasMedia)) {
        log.info(`deliverMessage: sending preceding text ` + `(${text.length} chars) before ${payloadType}`);
        await (0, deliver_1.sendTextLark)({ ...sendCtx, text });
    }
    // Card path.
    if (card) {
        const result = await (0, deliver_1.sendCardLark)({ ...sendCtx, card });
        log.info(`deliverMessage: card sent, messageId=${result.messageId}`);
        return (0, sdk_compat_1.jsonResult)({ ok: true, messageId: result.messageId, chatId: result.chatId });
    }
    // Media path.
    if (hasMedia) {
        // Multi-image merge: same semantics as outbound.sendPayload (F2).
        // ≥2 image URLs merge into a single rich-text post; any failure
        // falls back to sequential per-image sends so nothing is lost.
        const account = (0, accounts_1.getLarkAccount)(cfg, accountId ?? undefined);
        const multiImageMode = (0, multi_image_mode_1.resolveMultiImageMode)(account?.config);
        if (multiImageMode === 'post' &&
            mediaList.length >= 2 &&
            mediaList.every((u) => (0, media_1.isImageMediaUrl)(u))) {
            try {
                const imageKeys = [];
                for (const u of mediaList) {
                    const uploaded = await (0, media_1.uploadImageFromUrlLark)({
                        cfg,
                        mediaUrl: u,
                        mediaLocalRoots,
                        accountId: accountId ?? undefined,
                    });
                    imageKeys.push(uploaded.imageKey);
                }
                const groupResult = await (0, deliver_1.sendImageGroupPostLark)({
                    ...sendCtx,
                    imageKeys,
                });
                log.info(`deliverMessage: sent ${imageKeys.length} images as a single post, messageId=${groupResult.messageId}`);
                return (0, sdk_compat_1.jsonResult)({ ok: true, messageId: groupResult.messageId, chatId: groupResult.chatId });
            }
            catch (err) {
                log.warn(`deliverMessage: multi-image post failed ` +
                    `(${err instanceof Error ? err.message : String(err)}), ` +
                    `falling back to sequential image sends`);
            }
        }
        // Single media, mixed media, or sequential mode: keep legacy per-item
        // behaviour (fileName support + text-link fallback on upload error).
        let lastResult;
        for (const u of mediaList) {
            lastResult = await deliverMedia(cfg, { ...sp, mediaUrl: u }, accountId, mediaLocalRoots);
        }
        return lastResult;
    }
    // Text-only path.
    const result = await (0, deliver_1.sendTextLark)({ ...sendCtx, text });
    log.info(`deliverMessage: text sent, messageId=${result.messageId}`);
    return (0, sdk_compat_1.jsonResult)({ ok: true, messageId: result.messageId, chatId: result.chatId });
}
/**
 * Upload and send a media file with text-link fallback on failure.
 */
async function deliverMedia(cfg, sp, accountId, mediaLocalRoots) {
    const { to, mediaUrl, fileName, replyToMessageId, replyInThread } = sp;
    log.info(`deliverMedia: url=${mediaUrl}, fileName=${fileName ?? '(auto)'}`);
    try {
        const result = await (0, media_1.uploadAndSendMediaLark)({
            cfg,
            to,
            mediaUrl,
            fileName,
            replyToMessageId,
            replyInThread,
            accountId,
            mediaLocalRoots,
        });
        log.info(`deliverMedia: sent, messageId=${result.messageId}`);
        return (0, sdk_compat_1.jsonResult)({ ok: true, messageId: result.messageId, chatId: result.chatId });
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`deliverMedia: upload failed for "${mediaUrl}": ${errMsg}`);
        // Fallback: send the URL with error reason as a quote above.
        log.info('deliverMedia: falling back to text link');
        const fallback = await (0, deliver_1.sendTextLark)({
            cfg,
            to,
            text: `> ${mediaUrl}`,
            replyToMessageId,
            replyInThread,
            accountId,
        });
        return (0, sdk_compat_1.jsonResult)({
            ok: true,
            messageId: fallback.messageId,
            chatId: fallback.chatId,
            warning: `Media upload failed (${errMsg}). A text link was sent instead.`,
        });
    }
}
// ---------------------------------------------------------------------------
// Reaction handlers
// ---------------------------------------------------------------------------
async function handleReact(cfg, params, accountId) {
    const messageId = (0, param_readers_1.readStringParam)(params, 'messageId', { required: true });
    const { emoji, remove, isEmpty } = (0, sdk_compat_1.readReactionParams)(params, {
        removeErrorMessage: 'Emoji is required to remove a Feishu reaction.',
    });
    if (remove || isEmpty) {
        log.info(`react: removing emoji=${emoji || 'all'} from messageId=${messageId}`);
        const reactions = await (0, reactions_1.listReactionsFeishu)({
            cfg,
            messageId,
            emojiType: emoji || undefined,
            accountId,
        });
        const botReactions = reactions.filter((r) => r.operatorType === 'app');
        for (const r of botReactions) {
            await (0, reactions_1.removeReactionFeishu)({
                cfg,
                messageId,
                reactionId: r.reactionId,
                accountId,
            });
        }
        log.info(`react: removed ${botReactions.length} bot reaction(s)`);
        return (0, sdk_compat_1.jsonResult)({ ok: true, removed: botReactions.length });
    }
    log.info(`react: adding emoji=${emoji} to messageId=${messageId}`);
    const { reactionId } = await (0, reactions_1.addReactionFeishu)({
        cfg,
        messageId,
        emojiType: emoji,
        accountId,
    });
    log.info(`react: added reactionId=${reactionId}`);
    return (0, sdk_compat_1.jsonResult)({ ok: true, reactionId });
}
async function handleReactions(cfg, params, accountId) {
    const messageId = (0, param_readers_1.readStringParam)(params, 'messageId', { required: true });
    const emojiType = (0, param_readers_1.readStringParam)(params, 'emoji');
    const reactions = await (0, reactions_1.listReactionsFeishu)({
        cfg,
        messageId,
        emojiType: emojiType || undefined,
        accountId,
    });
    return (0, sdk_compat_1.jsonResult)({
        ok: true,
        reactions: reactions.map((r) => ({
            reactionId: r.reactionId,
            emoji: r.emojiType,
            operatorType: r.operatorType,
            operatorId: r.operatorId,
        })),
    });
}
// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
async function handleDelete(cfg, params, accountId) {
    const messageId = (0, param_readers_1.readStringParam)(params, 'messageId', { required: true });
    log.info(`delete: messageId=${messageId}`);
    const client = lark_client_1.LarkClient.fromCfg(cfg, accountId).sdk;
    const res = await client.im.message.delete({
        path: { message_id: messageId },
    });
    assertLarkOk(res, `delete message ${messageId}`);
    log.info(`delete: done, messageId=${messageId}`);
    return (0, sdk_compat_1.jsonResult)({ ok: true, messageId, deleted: true });
}
// ---------------------------------------------------------------------------
// Pin handlers
// ---------------------------------------------------------------------------
async function handlePin(cfg, params, accountId) {
    const messageId = (0, param_readers_1.readStringParam)(params, 'messageId', { required: true });
    log.info(`pin: messageId=${messageId}`);
    const pin = await (0, pins_1.createPinFeishu)({ cfg, messageId, accountId });
    log.info(`pin: done, messageId=${messageId}`);
    return (0, sdk_compat_1.jsonResult)({ ok: true, messageId, pin });
}
async function handleUnpin(cfg, params, accountId) {
    const messageId = (0, param_readers_1.readStringParam)(params, 'messageId', { required: true });
    log.info(`unpin: messageId=${messageId}`);
    await (0, pins_1.removePinFeishu)({ cfg, messageId, accountId });
    log.info(`unpin: done, messageId=${messageId}`);
    return (0, sdk_compat_1.jsonResult)({ ok: true, messageId, unpinned: true });
}
/**
 * Normalise a chat id from a `target`/`to`-style param. Accepts bare
 * `oc_xxx` as well as prefixed forms like `chat:oc_xxx` / `channel:oc_xxx` /
 * `group:oc_xxx`. Returns undefined for non-chat targets (e.g. `user:ou_xxx`)
 * so the current-conversation fallback can take over.
 */
function normalizePinChatId(raw) {
    if (typeof raw !== 'string')
        return undefined;
    const v = raw.trim();
    if (!v)
        return undefined;
    const m = /^(?:chat|channel|group):(.+)$/i.exec(v);
    const id = (m ? m[1] : v).trim();
    return /^oc_[a-z0-9]+$/i.test(id) ? id : undefined;
}
/**
 * Resolve the chat whose pins should be listed, in priority order:
 * explicit chatId/channelId params → target/to params → the invoking
 * session's current conversation (toolContext.currentChannelId).
 *
 * DM conversations surface as synthetic targets (`user:ou_xxx`) and the
 * Feishu chat list never includes p2p chats (verified 2026-09-03), so the
 * final fallback grounds the real chat id in the current turn's message
 * (`im/v1/messages/{id}` → chat_id) — a bot-identity lookup that only
 * works for conversations the bot is actually part of, preserving the
 * "exact current conversation" semantics of the pin guards.
 */
async function resolveListPinsChatId(cfg, params, accountId, toolContext) {
    const candidates = [
        (0, param_readers_1.readStringParam)(params, 'chatId'),
        (0, param_readers_1.readStringParam)(params, 'channelId'),
        params.target,
        params.to,
        toolContext?.currentChannelId,
    ];
    for (const candidate of candidates) {
        const chatId = normalizePinChatId(candidate);
        if (chatId)
            return chatId;
    }
    // DM fallback: real chat id of the conversation carrying this turn.
    const currentMessageId = typeof toolContext?.currentMessageId === 'string' && toolContext.currentMessageId
        ? toolContext.currentMessageId
        : undefined;
    if (currentMessageId) {
        const chatId = await (0, pins_1.resolveChatIdFromMessageFeishu)({
            cfg,
            messageId: currentMessageId,
            accountId,
        });
        log.info(`list-pins: resolved chat ${chatId} from current message ${currentMessageId}`);
        return chatId;
    }
    throw new Error('Feishu list-pins requires chatId or channelId (or call it from the conversation whose pins you want).');
}
async function handleListPins(cfg, params, accountId, toolContext) {
    const chatId = await resolveListPinsChatId(cfg, params, accountId, toolContext);
    const startTime = (0, param_readers_1.readStringParam)(params, 'startTime') ??
        (0, param_readers_1.readStringParam)(params, 'start_time');
    const endTime = (0, param_readers_1.readStringParam)(params, 'endTime') ??
        (0, param_readers_1.readStringParam)(params, 'end_time');
    const pageSize = (0, param_readers_1.readPositiveIntegerParam)(params, 'pageSize') ??
        (0, param_readers_1.readPositiveIntegerParam)(params, 'page_size');
    const pageToken = (0, param_readers_1.readStringParam)(params, 'pageToken') ??
        (0, param_readers_1.readStringParam)(params, 'page_token');
    log.info(`list-pins: chatId=${chatId}`);
    const result = await (0, pins_1.listPinsFeishu)({
        cfg,
        chatId,
        startTime,
        endTime,
        pageSize,
        pageToken,
        accountId,
    });
    log.info(`list-pins: ${result.pins.length} pin(s) in chat ${chatId}`);
    return (0, sdk_compat_1.jsonResult)({ ok: true, ...result });
}
