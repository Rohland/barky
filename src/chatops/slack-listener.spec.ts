import mockConsole from "jest-mock-console";
import { SlackChatOpsListener } from "./slack-listener.js";
import { ChatOpsConfig } from "./config.js";
import { ChatOpsService, IChatMessage } from "./chatops.service.js";
import { deleteDbIfExists, destroy, initConnection, recordChatThread } from "../models/db.js";

describe("SlackChatOpsListener", () => {

    const testDb = "dblistener";
    let restoreConsole;
    let handled: IChatMessage[];
    let pending: boolean;
    let acked: number;

    beforeEach(async () => {
        restoreConsole = mockConsole();
        deleteDbIfExists(testDb);
        await initConnection(testDb);
        handled = [];
        pending = false;
        acked = 0;
    });

    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
        restoreConsole();
    });

    function getSut() {
        const service = {
            handleMessage: async (message: IChatMessage) => {
                handled.push(message);
            },
            hasPendingSelection: () => pending
        } as unknown as ChatOpsService;
        return new SlackChatOpsListener(
            new ChatOpsConfig({ enabled: true, "app-token": "xapp-1" }),
            service);
    }

    const alertThreadTs = "1699999999.000100";

    async function recordAlertThread() {
        await recordChatThread({
            channel: "C1",
            threadTs: alertThreadTs,
            alertIds: ["web::health::a.com"]
        });
    }

    function envelopeFor(event: any) {
        return {
            ack: async () => {
                acked++;
            },
            event: {
                type: "message",
                channel: "C1",
                user: "U1",
                text: "mute",
                ts: "1700000000.000100",
                thread_ts: alertThreadTs,
                ...event
            }
        };
    }

    async function dispatch(sut: SlackChatOpsListener, event: any, isMention = false) {
        // onEvent is the listener's entry point once slack has routed the event
        // @ts-ignore
        await sut.onEvent(envelopeFor(event), isMention);
    }

    describe("when mentioned in the thread of one of its own alerts", () => {
        it("should handle the message", async () => {
            // arrange
            await recordAlertThread();
            const sut = getSut();

            // act
            await dispatch(sut, {}, true);

            // assert
            expect(handled).toHaveLength(1);
            expect(handled[0].text).toEqual("mute");
            expect(handled[0].threadTs).toEqual(alertThreadTs);
        });
    });

    describe("when the thread is not one barky posted an alert into", () => {
        it("should stay out of it, even when mentioned", async () => {
            // arrange - someone else's thread, which is none of barky's business
            const sut = getSut();

            // act
            await dispatch(sut, { thread_ts: "1234.5678" }, true);

            // assert
            expect(handled).toHaveLength(0);
            expect(acked).toEqual(1);
        });
    });

    describe("when mentioned at the top level of a channel", () => {
        it("should not respond, as there is no alert in context", async () => {
            await recordAlertThread();
            const sut = getSut();
            await dispatch(sut, { thread_ts: undefined }, true);
            expect(handled).toHaveLength(0);
        });
    });

    describe("when the message is a direct message", () => {
        it("should ignore it - barky only works in its own alert threads", async () => {
            const sut = getSut();
            await dispatch(sut, { channel_type: "im", thread_ts: undefined }, false);
            expect(handled).toHaveLength(0);
        });
    });

    describe("when the message comes from a bot", () => {
        it("should ignore it", async () => {
            // arrange - barky's own alerts arrive on this subscription too
            await recordAlertThread();
            const sut = getSut();

            // act
            await dispatch(sut, { bot_id: "B1" }, true);

            // assert
            expect(handled).toHaveLength(0);
            expect(acked).toEqual(1);
        });
    });

    describe("when the message has a subtype", () => {
        it("should ignore it", async () => {
            await recordAlertThread();
            const sut = getSut();
            await dispatch(sut, { subtype: "message_changed" }, true);
            expect(handled).toHaveLength(0);
        });
    });

    describe("when people talk to each other in an alert thread", () => {
        it("should not join in", async () => {
            // arrange - ordinary conversation about the outage, not addressed to barky
            await recordAlertThread();
            const sut = getSut();
            pending = false;

            // act
            await dispatch(sut, { text: "looks like the cache again" }, false);

            // assert
            expect(handled).toHaveLength(0);
        });
        describe("but barky is waiting on an answer from that person", () => {
            it("should take the reply without needing a mention", async () => {
                await recordAlertThread();
                const sut = getSut();
                pending = true;
                await dispatch(sut, { text: "1,3" }, false);
                expect(handled).toHaveLength(1);
            });
        });
    });

    describe("when the same message is delivered twice", () => {
        it("should only handle it once", async () => {
            // arrange - slack sends both app_mention and message for one mention, and redelivers
            // when an ack is missed
            await recordAlertThread();
            const sut = getSut();

            // act
            await dispatch(sut, {}, true);
            await dispatch(sut, {}, true);

            // assert
            expect(handled).toHaveLength(1);
            expect(acked).toEqual(2);
        });
    });

    describe("when the event is incomplete", () => {
        it.each([
            [{ user: undefined }],
            [{ text: undefined }],
            [{ ts: undefined }]
        ])("should ignore it", async (event) => {
            await recordAlertThread();
            const sut = getSut();
            await dispatch(sut, event, true);
            expect(handled).toHaveLength(0);
        });
    });
});
