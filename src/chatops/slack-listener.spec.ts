import mockConsole from "jest-mock-console";
import { SlackChatOpsListener, sharedConnections } from "./slack-listener.js";
import { ChatOpsConfig } from "./config.js";
import { ChatOpsService, IChatMessage } from "./chatops.service.js";
import { ChatOpsRouter } from "./router.js";
import { deleteDbIfExists, destroy, initConnection, recordChatThread } from "../models/db.js";
import { initLogger } from "../models/logger.js";

describe("SlackChatOpsListener", () => {

    const testDb = "dblistener";
    let restoreConsole;
    let handled: IChatMessage[];
    let acked: number;

    beforeEach(async () => {
        restoreConsole = mockConsole();
        deleteDbIfExists(testDb);
        await initConnection(testDb);
        handled = [];
        acked = 0;
    });

    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
        restoreConsole();
    });

    const barkySpar = "U05NX4E9VEW";
    const barkyYumbi = "U04LM2T8QAB";
    const colleague = "U0HKZGDKQ";
    // reading a message for the name of a barky is the service's job and is covered there, so
    // these are simply the texts these tests mean as naming one
    const namingABarky = [`<@${ barkySpar }>`, `<@${ barkyYumbi }>`, "@barky"];

    function serviceRecordingInto(into: IChatMessage[]): ChatOpsService {
        return {
            handleMessage: async (message: IChatMessage) => {
                into.push(message);
            },
            namesBarky: async (text: string) => namingABarky.some(x => text.includes(x)),
            pendingSelectionCount: 0
        } as unknown as ChatOpsService;
    }

    function getSut(router?: ChatOpsRouter) {
        return new SlackChatOpsListener(
            new ChatOpsConfig({ enabled: true, "app-token": "xapp-1" }),
            router ?? new ChatOpsRouter(serviceRecordingInto(handled)));
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

    // a listener whose only channel config is for another channel, so the thread below has none
    async function listenerForAnOptedOutChannel(): Promise<SlackChatOpsListener> {
        const sut = getSut(new ChatOpsRouter(
            serviceRecordingInto(handled),
            new Map([["slack-ops", serviceRecordingInto(handled)]])));
        await recordChatThread({
            channel: "C1",
            threadTs: alertThreadTs,
            alertIds: ["mysql::lag::db-01"],
            channelName: "slack-db"
        });
        return sut;
    }

    function logged(): string {
        return (console.log as jest.Mock).mock.calls.map(x => x.join(" ")).join("\n");
    }

    async function dispatch(sut: SlackChatOpsListener, event: any, isMention = false) {
        // routed through the same subscriptions start() wires into the socket mode client, so the
        // tests below cover which events barky actually listens to
        const handlers: Record<string, (envelope: any) => Promise<void>> = {};
        // @ts-ignore
        sut.subscribe({ on: (name: string, handler: any) => handlers[name] = handler });
        await handlers[isMention ? "app_mention" : "message"](envelopeFor(event));
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

    describe("when mentioned in the thread of a follow-up ping", () => {

        const pingThreadTs = "1699999999.000900";

        async function recordPingThread(url: string = null) {
            await recordChatThread({
                channel: "C1",
                threadTs: pingThreadTs,
                alertIds: [],
                pointsToTs: alertThreadTs,
                pointsToUrl: url
            });
        }

        it("should handle the message, saying where it belongs", async () => {
            // arrange - dropping it in silence reads exactly like barky having stopped working
            await recordPingThread("https://codeo.slack.com/archives/C1/p1699999999000100");
            const sut = getSut();

            // act
            await dispatch(sut, { thread_ts: pingThreadTs }, true);

            // assert
            expect(handled).toHaveLength(1);
            expect(handled[0].pointsTo).toEqual({
                url: "https://codeo.slack.com/archives/C1/p1699999999000100"
            });
        });
        it("should still handle it where there is no link to give", async () => {
            // arrange
            await recordPingThread(null);
            const sut = getSut();

            // act
            await dispatch(sut, { thread_ts: pingThreadTs }, true);

            // assert
            expect(handled).toHaveLength(1);
            expect(handled[0].pointsTo).toEqual({ url: null });
        });
        describe("an alert's own thread", () => {
            it("should point at nothing, so it is acted on as it always was", async () => {
                // arrange
                await recordAlertThread();
                const sut = getSut();

                // act
                await dispatch(sut, {}, true);

                // assert
                expect(handled[0].pointsTo).toBeNull();
            });
        });
    });

    describe("when the app covers more than one channel", () => {
        it("should answer with the channel config that posted the thread", async () => {
            // arrange - each install posts with its own bot token, and replying to a channel with
            // another one is refused by slack after the mute has already been applied
            const ops: IChatMessage[] = [];
            const db: IChatMessage[] = [];
            const sut = getSut(new ChatOpsRouter(
                serviceRecordingInto(ops),
                new Map([
                    ["slack-ops", serviceRecordingInto(ops)],
                    ["slack-db", serviceRecordingInto(db)]
                ])));
            await recordChatThread({
                channel: "C1",
                threadTs: alertThreadTs,
                alertIds: ["mysql::lag::db-01"],
                channelName: "slack-db"
            });

            // act
            await dispatch(sut, {}, true);

            // assert
            expect(db).toHaveLength(1);
            expect(ops).toHaveLength(0);
        });
        describe("and the channel that posted the thread has since opted out of chat ops", () => {
            it("should stay out of it, rather than answering as another channel", async () => {
                // arrange - a channel switched off keeps its recorded threads for the retention
                // window, and the socket stays up for the others, so its replies still arrive.
                // Acting on one would mute from a channel the operator has switched off, with a
                // token that may no longer be able to post the reply
                const ops: IChatMessage[] = [];
                const sut = getSut(new ChatOpsRouter(
                    serviceRecordingInto(ops),
                    new Map([["slack-ops", serviceRecordingInto(ops)]])));
                await recordChatThread({
                    channel: "C1",
                    threadTs: alertThreadTs,
                    alertIds: ["mysql::lag::db-01"],
                    channelName: "slack-db"
                });

                // act
                await dispatch(sut, {}, true);

                // assert
                expect(ops).toHaveLength(0);
                expect(acked).toEqual(1);
            });
            describe("and people are talking to each other in its threads", () => {
                // the log is the only thing an operator has to go on here, and a line saying barky
                // ignored a reply for every message with an @ in it makes it worthless
                afterEach(() => initLogger({}));

                it("should not report their chatter as a reply it ignored", async () => {
                    // arrange - said out loud, which is the only place this shows up
                    initLogger({ debug: true });
                    const sut = await listenerForAnOptedOutChannel();

                    // act
                    await dispatch(sut, { text: `<@${ colleague }> can you look at this?` }, false);

                    // assert
                    expect(logged()).not.toContain("no longer has chat ops enabled");
                });
                it("should still report a reply that was for barky", async () => {
                    // arrange - a mention slack delivers as one is still worth explaining
                    initLogger({ debug: true });
                    const sut = await listenerForAnOptedOutChannel();

                    // act
                    await dispatch(sut, { text: `<@${ barkySpar }> 1` }, true);

                    // assert
                    expect(logged()).toContain("no longer has chat ops enabled");
                });
            });
        });
        describe("for a thread recorded before barky noted which channel posted it", () => {
            it("should fall back to the channel that declared chat ops", async () => {
                // arrange - rows written by an older barky carry no channel name
                const ops: IChatMessage[] = [];
                const db: IChatMessage[] = [];
                const sut = getSut(new ChatOpsRouter(
                    serviceRecordingInto(ops),
                    new Map([["slack-db", serviceRecordingInto(db)]])));
                await recordAlertThread();

                // act
                await dispatch(sut, {}, true);

                // assert
                expect(ops).toHaveLength(1);
                expect(db).toHaveLength(0);
            });
        });
    });

    describe("when the slack app has more than one socket open", () => {
        // slack hands each event to one connection rather than all of them, so a second barky on
        // the same app token silently takes a share of the replies meant for this one
        const hello = (connections: number) =>
            `Received a message on the WebSocket: {"type":"hello","num_connections":${ connections },"debug_info":{"host":"applink-14"}}`;

        it("should read how many there are, so the log can say why some replies arrive late", async () => {
            expect(sharedConnections(hello(4))).toEqual(4);
        });
        describe("when it is the only one", () => {
            it("should report none, since there is nothing to explain", async () => {
                expect(sharedConnections(hello(1))).toEqual(0);
            });
        });
        describe("for any other socket chatter", () => {
            it("should report none", async () => {
                expect(sharedConnections('Received a message: {"type":"events_api","num_connections":9}')).toEqual(0);
                expect(sharedConnections("Initiating new WebSocket connection.")).toEqual(0);
                expect(sharedConnections(null)).toEqual(0);
            });
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
        it.each([
            ["looks like the cache again"],
            ["all"],
            ["1,3"],
            ["mute all"]
        ])("should not join in, even when someone says '%s'", async (text) => {
            // arrange - people discussing an outage must be able to say "all" or "1" to each other
            // without barky acting on it, including while it is waiting on an answer
            await recordAlertThread();
            const sut = getSut();

            // act
            await dispatch(sut, { text }, false);

            // assert
            expect(handled).toHaveLength(0);
        });
        describe("and the reply names barky", () => {
            it("should be taken as an answer", async () => {
                await recordAlertThread();
                const sut = getSut();
                await dispatch(sut, { text: `<@${ barkySpar }> 1,3` }, true);
                expect(handled).toHaveLength(1);
            });
        });
        describe("and they name each other in it", () => {
            it("should still stay out of it", async () => {
                // arrange - the message is delivered because it names someone, but not barky
                await recordAlertThread();
                const sut = getSut();

                // act
                await dispatch(sut, { text: `<@${ colleague }> can you look at this?` }, false);

                // assert
                expect(handled).toHaveLength(0);
            });
        });
    });

    describe("when several barkys sit in the same channel", () => {
        // slack delivers a reply naming the wrong barky to none of them as a mention, so it
        // arrives as an ordinary channel message instead - see "Several barkys in one channel" in
        // the README
        it("should answer a reply that names another barky, in a thread it posted", async () => {
            // arrange
            await recordAlertThread();
            const sut = getSut();

            // act
            await dispatch(sut, { text: `<@${ barkyYumbi }> 1` }, false);

            // assert
            expect(handled).toHaveLength(1);
            expect(handled[0].text).toEqual(`<@${ barkyYumbi }> 1`);
        });
        it("should answer one naming a barky slack never linked up", async () => {
            await recordAlertThread();
            const sut = getSut();
            await dispatch(sut, { text: "@barky 1" }, false);
            expect(handled).toHaveLength(1);
        });
        describe("in a thread it did not post", () => {
            it("should stay out of it, and leave it to the barky that did", async () => {
                // arrange - the other barky owns this thread, and only it knows what the numbers
                // in the reply mean or how to mute what they name
                const sut = getSut();

                // act
                await dispatch(sut, { text: `<@${ barkyYumbi }> 1`, thread_ts: "1234.5678" }, false);

                // assert
                expect(handled).toHaveLength(0);
                expect(acked).toEqual(1);
            });
        });
    });

    describe("when the same reply arrives as both a mention and a message", () => {
        it("should only answer once", async () => {
            // arrange - slack sends both for a mention of this bot, and now reads the message as
            // naming a barky too
            await recordAlertThread();
            const sut = getSut();

            // act
            await dispatch(sut, { text: `<@${ barkySpar }> 1` }, true);
            await dispatch(sut, { text: `<@${ barkySpar }> 1` }, false);

            // assert
            expect(handled).toHaveLength(1);
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
