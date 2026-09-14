import mockConsole from "jest-mock-console";
import { SlackChatOpsListener } from "./slack-listener.js";
import { ChatOpsConfig } from "./config.js";
import { ChatOpsService, IChatMessage } from "./chatops.service.js";
import { deleteDbIfExists, destroy, initConnection } from "../models/db.js";

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
                ...event
            }
        };
    }

    async function dispatch(sut: SlackChatOpsListener, event: any, isMention = false) {
        // onEvent is the listener's entry point once slack has routed the event
        // @ts-ignore
        await sut.onEvent(envelopeFor(event), isMention);
    }

    describe("when mentioned", () => {
        it("should handle the message", async () => {
            const sut = getSut();
            await dispatch(sut, {}, true);
            expect(handled).toHaveLength(1);
            expect(handled[0].text).toEqual("mute");
            expect(handled[0].ts).toEqual("1700000000.000100");
        });
    });

    describe("when the message is a direct message", () => {
        it("should handle it", async () => {
            const sut = getSut();
            await dispatch(sut, { channel_type: "im" });
            expect(handled).toHaveLength(1);
        });
    });

    describe("when the message comes from a bot", () => {
        it("should ignore it", async () => {
            // arrange - barky's own alerts arrive on this subscription too
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
            const sut = getSut();
            await dispatch(sut, { subtype: "message_changed" }, true);
            expect(handled).toHaveLength(0);
        });
    });

    describe("when an unaddressed channel message arrives", () => {
        it("should ignore it", async () => {
            const sut = getSut();
            await dispatch(sut, { text: "deploying now" });
            expect(handled).toHaveLength(0);
        });
        describe("in a thread with a list awaiting a reply", () => {
            it("should handle it without needing a mention", async () => {
                const sut = getSut();
                pending = true;
                await dispatch(sut, { text: "1,3", thread_ts: "1699999999.000100" });
                expect(handled).toHaveLength(1);
                expect(handled[0].threadTs).toEqual("1699999999.000100");
            });
        });
        describe("in a thread with nothing awaiting a reply", () => {
            it("should ignore it", async () => {
                const sut = getSut();
                pending = false;
                await dispatch(sut, { text: "1,3", thread_ts: "1699999999.000100" });
                expect(handled).toHaveLength(0);
            });
        });
    });

    describe("when the same message is delivered twice", () => {
        it("should only handle it once", async () => {
            // arrange - slack sends both app_mention and message for one mention, and redelivers
            // when an ack is missed
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
            const sut = getSut();
            await dispatch(sut, event, true);
            expect(handled).toHaveLength(0);
        });
    });
});
