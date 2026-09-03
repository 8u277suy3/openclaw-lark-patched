import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pinsModule = require("../../src/messaging/outbound/pins.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feishuMessageActions } = require("../../src/messaging/outbound/actions.js");

beforeEach(() => {
  // Spy on the real pins functions so the action dispatcher routes to spies.
  vi.spyOn(pinsModule, "createPinFeishu").mockResolvedValue({ messageId: "om_1" });
  vi.spyOn(pinsModule, "removePinFeishu").mockResolvedValue(undefined);
  vi.spyOn(pinsModule, "listPinsFeishu").mockResolvedValue({
    chatId: "oc_1",
    pins: [],
    hasMore: false,
  });
  vi.spyOn(pinsModule, "resolveP2PChatIdFeishu").mockResolvedValue("oc_p2p1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("message actions — pin routing", () => {
  it("declares pin/unpin/list-pins as supported actions", () => {
    expect(feishuMessageActions.supportsAction({ action: "pin" })).toBe(true);
    expect(feishuMessageActions.supportsAction({ action: "unpin" })).toBe(true);
    expect(feishuMessageActions.supportsAction({ action: "list-pins" })).toBe(true);
    expect(feishuMessageActions.supportsAction({ action: "unsupported-xyz" })).toBe(false);
  });

  it("routes pin action to createPinFeishu with messageId", async () => {
    const result = await feishuMessageActions.handleAction({
      action: "pin",
      params: { messageId: "om_1" },
      cfg: {},
    });
    expect(pinsModule.createPinFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "om_1" }),
    );
    expect(result.details).toMatchObject({ ok: true, messageId: "om_1" });
  });

  it("routes unpin action to removePinFeishu", async () => {
    const result = await feishuMessageActions.handleAction({
      action: "unpin",
      params: { messageId: "om_2" },
      cfg: {},
    });
    expect(pinsModule.removePinFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "om_2" }),
    );
    expect(result.details).toMatchObject({ ok: true, messageId: "om_2", unpinned: true });
  });

  it("routes list-pins to listPinsFeishu with chatId", async () => {
    const result = await feishuMessageActions.handleAction({
      action: "list-pins",
      params: { chatId: "oc_9" },
      cfg: {},
    });
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_9" }),
    );
    expect(result.details).toMatchObject({ ok: true });
  });

  it("supports channelId alias for list-pins", async () => {
    const result = await feishuMessageActions.handleAction({
      action: "list-pins",
      params: { channelId: "oc_10" },
      cfg: {},
    });
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_10" }),
    );
    expect(result.details).toMatchObject({ ok: true });
  });

  it("forwards pagination params for list-pins", async () => {
    await feishuMessageActions.handleAction({
      action: "list-pins",
      params: { chatId: "oc_1", pageSize: 30, startTime: "2026-09-01T00:00:00Z" },
      cfg: {},
    });
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "oc_1",
        pageSize: 30,
        startTime: "2026-09-01T00:00:00Z",
      }),
    );
  });

  it("normalises prefixed target for list-pins", async () => {
    await feishuMessageActions.handleAction({
      action: "list-pins",
      params: { target: "chat:oc_7" },
      cfg: {},
    });
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_7" }),
    );
  });

  it("falls back to current conversation chatId for bare list-pins", async () => {
    await feishuMessageActions.handleAction({
      action: "list-pins",
      params: {},
      cfg: {},
      toolContext: { currentChannelId: "oc_42" },
    });
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_42" }),
    );
  });

  it("resolves user: target to p2p chat via bot chat list", async () => {
    await feishuMessageActions.handleAction({
      action: "list-pins",
      params: { target: "user:ou_abc" },
      cfg: {},
    });
    expect(pinsModule.resolveP2PChatIdFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ openId: "ou_abc" }),
    );
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_p2p1" }),
    );
  });

  it("resolves synthetic currentChannelId (DM) for bare list-pins", async () => {
    await feishuMessageActions.handleAction({
      action: "list-pins",
      params: {},
      cfg: {},
      toolContext: { currentChannelId: "user:ou_def" },
    });
    expect(pinsModule.resolveP2PChatIdFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ openId: "ou_def" }),
    );
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_p2p1" }),
    );
  });

  it("prefers explicit oc_ chatId over synthetic fallback", async () => {
    await feishuMessageActions.handleAction({
      action: "list-pins",
      params: { chatId: "oc_explicit" },
      cfg: {},
      toolContext: { currentChannelId: "user:ou_def" },
    });
    expect(pinsModule.resolveP2PChatIdFeishu).not.toHaveBeenCalled();
    expect(pinsModule.listPinsFeishu).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "oc_explicit" }),
    );
  });

  it("rejects list-pins without chatId", async () => {
    await expect(
      feishuMessageActions.handleAction({ action: "list-pins", params: {}, cfg: {} }),
    ).rejects.toThrow(/chatId/i);
  });

  it("rejects pin without messageId", async () => {
    await expect(
      feishuMessageActions.handleAction({ action: "pin", params: {}, cfg: {} }),
    ).rejects.toThrow(/messageId/i);
  });

  it("propagates pins-module failures", async () => {
    vi.mocked(pinsModule.createPinFeishu).mockRejectedValue(new Error("pin failed"));
    await expect(
      feishuMessageActions.handleAction({ action: "pin", params: { messageId: "om_1" }, cfg: {} }),
    ).rejects.toThrow(/pin failed/i);
  });
});
