import mockConsole from "jest-mock-console";
import { ChatOpsService, IAlertSource, IChatMessage } from "./chatops.service.js";
import { AiUnavailableError, IIntent, IIntentContext, IIntentResolver, IntentAction } from "./ai/types.js";
import { ChatOpsConfig } from "./config.js";
import { ISelectionCandidate, SelectionStore } from "./selection.js";
import { SlackMaxMessageLength } from "../models/channels/slack-api.js";
import { SlackApi } from "../models/channels/slack-api.js";
import { Muter } from "../muter.js";
import { deleteDbIfExists, destroy, getChatOpsAudit, initConnection, recordChatThread } from "../models/db.js";
import { initLocaleAndTimezone } from "../lib/utility.js";
import { singleton } from "../lib/singleton.js";

describe("ChatOpsService", () => {

    const testDb = "dbchatops";
    let restoreConsole;
    let posted: { channel: string, text: string, threadTs: string }[];
    let reactions: string[];

    beforeEach(async () => {
        restoreConsole = mockConsole();
        deleteDbIfExists(testDb);
        await initConnection(testDb);
        initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
        posted = [];
        reactions = [];
        // the muter is a process wide singleton, so it is reset per test against the test db
        const muter = singleton(Muter.name, () => new Muter()) as Muter;
        await muter.init({ "mute-windows": [] });
    });

    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
        restoreConsole();
    });

    function getApi(): SlackApi {
        return {
            postMessage: async (channel: string, text: string, threadTs?: string) => {
                posted.push({ channel, text, threadTs });
                return { channel, ts: 1 };
            },
            addReaction: async (_channel: string, _ts: string, reaction: string) => {
                reactions.push(reaction);
            }
        } as unknown as SlackApi;
    }

    function getAlertSource(ids: string[]): IAlertSource {
        return {
            getActiveAlerts: async (): Promise<ISelectionCandidate[]> =>
                ids.map(id => ({ id, title: id, detail: "failed" }))
        };
    }

    function getSut(ids: string[], config: any = {}, resolver: IIntentResolver = null) {
        return new ChatOpsService(
            new ChatOpsConfig({ enabled: true, "app-token": "x", ...config }),
            getApi(),
            getAlertSource(ids),
            resolver);
    }

    function resolverReturning(intent: Partial<IIntent>): IIntentResolver {
        return {
            resolve: async (): Promise<IIntent> => ({
                action: IntentAction.Reply,
                numbers: [],
                all: false,
                ...intent
            })
        };
    }

    function resolverCapturing(context: { value?: IIntentContext }, intent: Partial<IIntent>): IIntentResolver {
        return {
            resolve: async (ctx: IIntentContext): Promise<IIntent> => {
                context.value = ctx;
                return {
                    action: IntentAction.Reply,
                    numbers: [],
                    all: false,
                    ...intent
                };
            }
        };
    }

    function messageFrom(text: string, overrides: Partial<IChatMessage> = {}): IChatMessage {
        return {
            channel: "C1",
            ts: "100.000100",
            userId: "U1",
            text,
            ...overrides
        };
    }

    function lastReply() {
        return posted[posted.length - 1].text;
    }

    const twoAlerts = ["web::health::a.com", "mysql::lag::db-01"];

    function manyLongIds(count: number) {
        return Array.from(
            { length: count },
            (_, i) => `web::health-check-with-a-very-long-label::host-${ i }.some-long-domain.example.com`);
    }

    describe("mute", () => {
        it("should reply with a numbered list of the active alerts", async () => {
            // arrange
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(messageFrom("mute"));

            // assert
            expect(posted).toHaveLength(1);
            expect(posted[0].threadTs).toEqual("100.000100");
            expect(lastReply()).toContain("2 active alerts");
            expect(lastReply()).toContain("`1.` web::health::a.com");
            expect(lastReply()).toContain("`2.` mysql::lag::db-01");
        });
        describe("when there is nothing alerting", () => {
            it("should say so", async () => {
                const sut = getSut([]);
                await sut.handleMessage(messageFrom("mute"));
                expect(lastReply()).toContain("Nothing to mute");
            });
        });
        describe("when the list would not fit in a slack message", () => {
            it("should point at the dashboard instead of numbering it", async () => {
                // arrange
                const sut = getSut(manyLongIds(60), { "dashboard-url": "https://barky.acme.com" });

                // act
                await sut.handleMessage(messageFrom("mute"));

                // assert
                expect(lastReply().length).toBeLessThanOrEqual(SlackMaxMessageLength);
                expect(lastReply()).toContain("will fit in a single Slack message");
                expect(lastReply()).toContain("https://barky.acme.com");
                expect(lastReply()).toContain("`mute all`");
            });
            it("should not pin a list it never showed", async () => {
                const sut = getSut(manyLongIds(60));
                await sut.handleMessage(messageFrom("mute"));
                expect(sut.hasPendingSelection("C1", "100.000100", "U1")).toEqual(false);
            });
            describe("and the user asks to mute all", () => {
                it("should mute them regardless, since that needs no list", async () => {
                    // arrange
                    const ids = manyLongIds(60);
                    const sut = getSut(ids);

                    // act
                    await sut.handleMessage(messageFrom("mute all"));

                    // assert
                    expect(lastReply()).toContain("Muted until");
                    expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(ids.length);
                });
            });
        });
        describe("when a long list still fits", () => {
            it("should number it rather than deferring to the dashboard", async () => {
                // arrange - many short identifiers, which a fixed row cap would have rejected
                const sut = getSut(Array.from({ length: 30 }, (_, i) => `web::h::s${ i }`));

                // act
                await sut.handleMessage(messageFrom("mute"));

                // assert
                expect(lastReply()).toContain("`30.`");
                expect(lastReply().length).toBeLessThanOrEqual(SlackMaxMessageLength);
            });
        });
    });

    describe("replying to a pinned list", () => {
        it("should mute only the numbers selected", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("1"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(mutes).toHaveLength(1);
            expect(mutes[0].match).toEqual("^web::health::a\\.com$");
            expect(lastReply()).toContain("web::health::a.com");
            expect(lastReply()).not.toContain("mysql::lag::db-01");
        });
        it("should treat 'all' as everything on that list", async () => {
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));
            await sut.handleMessage(messageFrom("all"));
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);
        });
        describe("when an alert fires after the list was drawn", () => {
            it("should not mute it, and should say so", async () => {
                // arrange - the alert source grows between the list and the reply
                const ids = [...twoAlerts];
                const alerts: IAlertSource = {
                    getActiveAlerts: async () => ids.map(id => ({ id, title: id, detail: "failed" }))
                };
                const sut = new ChatOpsService(
                    new ChatOpsConfig({ enabled: true, "app-token": "x" }),
                    getApi(),
                    alerts);
                await sut.handleMessage(messageFrom("mute"));
                ids.push("web::health::new.com");

                // act
                await sut.handleMessage(messageFrom("all"));

                // assert
                const mutes = await Muter.getInstance().getDynamicMutes();
                expect(mutes).toHaveLength(2);
                expect(mutes.some(x => x.match.includes("new"))).toEqual(false);
                expect(lastReply()).toContain("fired after that list was drawn");
                expect(lastReply()).toContain("web::health::new.com");
            });
        });
        describe("when a selected alert resolved in the meantime", () => {
            it("should mute it anyway and note it", async () => {
                // arrange
                const ids = [...twoAlerts];
                const alerts: IAlertSource = {
                    getActiveAlerts: async () => ids.map(id => ({ id, title: id, detail: "failed" }))
                };
                const sut = new ChatOpsService(
                    new ChatOpsConfig({ enabled: true, "app-token": "x" }),
                    getApi(),
                    alerts);
                await sut.handleMessage(messageFrom("mute"));
                ids.pop();

                // act
                await sut.handleMessage(messageFrom("all"));

                // assert
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);
                expect(lastReply()).toContain("had already resolved");
            });
        });
        describe("when a number is out of range", () => {
            it("should refuse without muting anything", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("mute"));
                await sut.handleMessage(messageFrom("5"));
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
                expect(lastReply()).toContain("only goes up to 2");
            });
        });
        describe("when another user replies with numbers", () => {
            it("should not resolve against someone else's list", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("mute"));
                await sut.handleMessage(messageFrom("1", { userId: "U2" }));
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
                expect(lastReply()).toContain("didn't understand");
            });
        });
        describe("when the user cancels", () => {
            it("should change nothing", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("mute"));
                await sut.handleMessage(messageFrom("cancel"));
                await sut.handleMessage(messageFrom("1"));
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
            });
        });
    });

    describe("mute duration", () => {
        it("should default to the next business day", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("1"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(mutes[0].to.getTime()).toBeGreaterThan(Date.now());
            // the business day default always lands on an 08:00 boundary
            const { toLocalDateAndTime } = await import("../lib/utility.js");
            expect(toLocalDateAndTime(mutes[0].to).time).toEqual("08:00");
        });
        it("should honour an explicit period", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("1 for 4h"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            const fourHours = 4 * 60 * 60 * 1000;
            expect(Math.abs(mutes[0].to.getTime() - (Date.now() + fourHours))).toBeLessThan(5000);
        });
    });

    describe("unmute", () => {
        it("should list the active mutes and lift the ones selected", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));
            await sut.handleMessage(messageFrom("all"));
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);

            // act
            await sut.handleMessage(messageFrom("unmute"));
            const list = lastReply();
            await sut.handleMessage(messageFrom("1"));

            // assert - the pattern is shown back in readable form, not as an escaped regex
            expect(list).toContain("`1.` web::health::a.com");
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(1);
            expect(lastReply()).toContain("Lifted 1 mute");
        });
        describe("when nothing is muted", () => {
            it("should say so", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("unmute"));
                expect(lastReply()).toContain("no active mutes");
            });
        });
    });

    describe("status", () => {
        it("should report what is alerting", async () => {
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("status"));
            expect(lastReply()).toContain("2 active alerts");
            expect(lastReply()).toContain("web::health::a.com");
        });
    });

    describe("help", () => {
        it("should explain the commands", async () => {
            const sut = getSut([], { "dashboard-url": "https://barky.acme.com" });
            await sut.handleMessage(messageFrom("help"));
            expect(lastReply()).toContain("mute all");
            expect(lastReply()).toContain("https://barky.acme.com");
        });
    });

    describe("when the message is in a thread", () => {
        it("should reply in that thread", async () => {
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute", { ts: "200.000200", threadTs: "100.000100" }));
            expect(posted[0].threadTs).toEqual("100.000100");
        });
    });

    describe("when handling throws", () => {
        it("should report the failure rather than going silent", async () => {
            // arrange
            const alerts: IAlertSource = {
                getActiveAlerts: async () => {
                    throw new Error("boom");
                }
            };
            const sut = new ChatOpsService(
                new ChatOpsConfig({ enabled: true, "app-token": "x" }),
                getApi(),
                alerts);

            // act
            await sut.handleMessage(messageFrom("mute"));

            // assert
            expect(lastReply()).toContain("Something went wrong");
        });
    });
    describe("when the message needs interpreting", () => {
        describe("and no ai service is configured", () => {
            it("should say it did not understand", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("silence the noisy database thing"));
                expect(lastReply()).toContain("didn't understand");
            });
        });

        describe("and the ai service resolves it to a mute", () => {
            it("should mute exactly what it chose", async () => {
                // arrange
                const sut = getSut(
                    twoAlerts,
                    {},
                    resolverReturning({ action: IntentAction.Mute, numbers: [2] }));

                // act
                await sut.handleMessage(messageFrom("mute the database one"));

                // assert
                const mutes = await Muter.getInstance().getDynamicMutes();
                expect(mutes).toHaveLength(1);
                expect(mutes[0].match).toEqual("^mysql::lag::db-01$");
            });
            it("should acknowledge the message while it thinks", async () => {
                const sut = getSut(twoAlerts, {}, resolverReturning({ action: IntentAction.Mute, numbers: [1] }));
                await sut.handleMessage(messageFrom("mute the web one"));
                expect(reactions).toEqual(["eyes"]);
            });
            describe("with a period", () => {
                it("should honour it", async () => {
                    // arrange
                    const sut = getSut(
                        twoAlerts,
                        {},
                        resolverReturning({ action: IntentAction.Mute, numbers: [1], duration: "90m" }));

                    // act
                    await sut.handleMessage(messageFrom("mute the web one for an hour and a half"));

                    // assert
                    const mutes = await Muter.getInstance().getDynamicMutes();
                    const ninetyMinutes = 90 * 60 * 1000;
                    expect(Math.abs(mutes[0].to.getTime() - (Date.now() + ninetyMinutes))).toBeLessThan(5000);
                });
            });
            describe("with a named moment", () => {
                it("should mute until then", async () => {
                    // arrange - a wall clock time in the configured timezone
                    const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
                    const { toLocalDateAndTime } = await import("../lib/utility.js");
                    const local = toLocalDateAndTime(until);
                    const sut = getSut(
                        twoAlerts,
                        {},
                        resolverReturning({
                            action: IntentAction.Mute,
                            numbers: [1],
                            until: `${ local.date } ${ local.time }`
                        }));

                    // act
                    await sut.handleMessage(messageFrom("mute the web one until thursday"));

                    // assert
                    const mutes = await Muter.getInstance().getDynamicMutes();
                    expect(Math.abs(mutes[0].to.getTime() - until.getTime())).toBeLessThan(60 * 1000);
                });
            });
        });

        describe("and the ai service asks for a period beyond the maximum", () => {
            it("should cap it", async () => {
                // arrange
                const sut = getSut(
                    twoAlerts,
                    { "max-mute": "2h" },
                    resolverReturning({ action: IntentAction.Mute, numbers: [1], duration: "30d" }));

                // act
                await sut.handleMessage(messageFrom("mute the web one for a month"));

                // assert
                const mutes = await Muter.getInstance().getDynamicMutes();
                const twoHours = 2 * 60 * 60 * 1000;
                expect(Math.abs(mutes[0].to.getTime() - (Date.now() + twoHours))).toBeLessThan(5000);
            });
            describe("but barky's own default runs longer", () => {
                it("should not cap the default", async () => {
                    // arrange - the business day default can reach into next week
                    const sut = getSut(twoAlerts, { "max-mute": "1m" });

                    // act
                    await sut.handleMessage(messageFrom("mute"));
                    await sut.handleMessage(messageFrom("1"));

                    // assert
                    const mutes = await Muter.getInstance().getDynamicMutes();
                    const oneMinute = 60 * 1000;
                    expect(mutes[0].to.getTime()).toBeGreaterThan(Date.now() + oneMinute);
                });
            });
        });

        describe("and the ai service resolves it against a pinned list", () => {
            it("should apply the selection", async () => {
                // arrange
                const captured: { value?: IIntentContext } = {};
                const sut = getSut(
                    twoAlerts,
                    {},
                    resolverCapturing(captured, { action: IntentAction.Select, numbers: [2] }));
                await sut.handleMessage(messageFrom("mute"));

                // act
                await sut.handleMessage(messageFrom("just the database one please"));

                // assert - it was told a list is pinned, and given that list
                expect(captured.value.pinned).toEqual("mute");
                expect(captured.value.candidates).toHaveLength(2);
                const mutes = await Muter.getInstance().getDynamicMutes();
                expect(mutes).toHaveLength(1);
                expect(mutes[0].match).toContain("mysql");
            });
        });

        describe("and the ai service asks barky to show a list", () => {
            it("should show it", async () => {
                const sut = getSut(twoAlerts, {}, resolverReturning({ action: IntentAction.RequestMuteList }));
                await sut.handleMessage(messageFrom("something needs silencing"));
                expect(lastReply()).toContain("2 active alerts");
                expect(lastReply()).toContain("`1.`");
            });
        });

        describe("and the ai service answers in words", () => {
            it("should relay the answer", async () => {
                const sut = getSut(
                    twoAlerts,
                    {},
                    resolverReturning({ action: IntentAction.Reply, message: "Two things are broken." }));
                await sut.handleMessage(messageFrom("how bad is it?"));
                expect(lastReply()).toEqual("Two things are broken.");
            });
        });

        describe("and the ai service cannot be reached", () => {
            it("should say so and point at the dashboard, changing nothing", async () => {
                // arrange
                const resolver: IIntentResolver = {
                    resolve: async () => {
                        throw new AiUnavailableError("down");
                    }
                };
                const sut = getSut(twoAlerts, { "dashboard-url": "https://barky.acme.com" }, resolver);

                // act
                await sut.handleMessage(messageFrom("silence the noisy one"));

                // assert
                expect(lastReply()).toContain("can't reach the AI service");
                expect(lastReply()).toContain("https://barky.acme.com");
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
            });
            describe("but a plain numbered reply is waiting", () => {
                it("should still work, since that needs no interpretation", async () => {
                    // arrange
                    const resolver: IIntentResolver = {
                        resolve: async () => {
                            throw new AiUnavailableError("down");
                        }
                    };
                    const sut = getSut(twoAlerts, {}, resolver);
                    await sut.handleMessage(messageFrom("mute"));

                    // act
                    await sut.handleMessage(messageFrom("1,2"));

                    // assert
                    expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);
                });
            });
        });
    });
    describe("when replying inside an alert's own thread", () => {

        const threadTs = "1699999999.000100";

        function threadMessage(text: string) {
            return messageFrom(text, { ts: "1700000000.000200", threadTs });
        }

        describe("and the thread reported a single alert", () => {
            it("should mute it directly, without making the user pick from a list", async () => {
                // arrange
                await recordChatThread({
                    channel: "C1",
                    threadTs,
                    alertIds: ["web::health::a.com"]
                });
                const sut = getSut(twoAlerts);

                // act
                await sut.handleMessage(threadMessage("mute"));

                // assert
                const mutes = await Muter.getInstance().getDynamicMutes();
                expect(mutes).toHaveLength(1);
                expect(mutes[0].match).toContain("a\\.com");
                expect(lastReply()).toContain("Muted until");
            });
        });

        describe("and the thread reported several alerts", () => {
            it("should offer only those, not everything active", async () => {
                // arrange - three alerts are active, but this thread only reported two
                const sut = getSut([...twoAlerts, "web::health::unrelated.com"]);
                await recordChatThread({ channel: "C1", threadTs, alertIds: twoAlerts });

                // act
                await sut.handleMessage(threadMessage("mute"));

                // assert
                expect(lastReply()).toContain("2 active alerts");
                expect(lastReply()).not.toContain("unrelated.com");
            });
            describe("and the user says 'mute this'", () => {
                it("should mute all of them", async () => {
                    // arrange
                    const sut = getSut([...twoAlerts, "web::health::unrelated.com"]);
                    await recordChatThread({ channel: "C1", threadTs, alertIds: twoAlerts });

                    // act
                    await sut.handleMessage(threadMessage("mute this"));

                    // assert - the unrelated alert is untouched
                    const mutes = await Muter.getInstance().getDynamicMutes();
                    expect(mutes).toHaveLength(2);
                    expect(mutes.some(x => x.match.includes("unrelated"))).toEqual(false);
                });
            });
            describe("and the user picks from the scoped list", () => {
                it("should not report unrelated alerts as drift", async () => {
                    // arrange - the scoped list was never a list of everything
                    const sut = getSut([...twoAlerts, "web::health::unrelated.com"]);
                    await recordChatThread({ channel: "C1", threadTs, alertIds: twoAlerts });
                    await sut.handleMessage(threadMessage("mute"));

                    // act
                    await sut.handleMessage(threadMessage("1"));

                    // assert
                    expect(lastReply()).not.toContain("fired after that list");
                });
            });
        });

        describe("and everything the thread reported has cleared", () => {
            it("should say so rather than muting nothing", async () => {
                // arrange
                const sut = getSut(twoAlerts);
                await recordChatThread({ channel: "C1", threadTs, alertIds: ["web::health::gone.com"] });

                // act
                await sut.handleMessage(threadMessage("mute"));

                // assert
                expect(lastReply()).toContain("already cleared");
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
            });
        });

        describe("and barky did not post that thread", () => {
            it("should fall back to everything active", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(threadMessage("mute"));
                expect(lastReply()).toContain("2 active alerts");
            });
        });

        describe("and 'mute this' is said outside a thread", () => {
            it("should show the list rather than muting everything", async () => {
                // arrange - "this" has no referent at channel level, so it must not mean "all"
                const sut = getSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("mute this"));

                // assert
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
                expect(lastReply()).toContain("2 active alerts");
            });
        });
    });

    describe("the audit trail", () => {
        it("should record who muted what, and until when", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("1 for 4h", { userId: "U1" }));

            // assert
            const audit = await getChatOpsAudit();
            expect(audit).toHaveLength(1);
            expect(audit[0].action).toEqual("mute");
            expect(audit[0].userId).toEqual("U1");
            expect(audit[0].channel).toEqual("C1");
            expect(audit[0].detail.alerts).toEqual(["web::health::a.com"]);
            expect(audit[0].detail.requested).toEqual("1 for 4h");
            expect(new Date(audit[0].detail.until).getTime()).toBeGreaterThan(Date.now());
        });
        it("should record lifted mutes too", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute all"));

            // act
            await sut.handleMessage(messageFrom("unmute all"));

            // assert
            const audit = await getChatOpsAudit();
            expect(audit.map(x => x.action)).toEqual(["unmute", "mute"]);
            expect(audit[0].detail.mutes).toHaveLength(2);
        });
    });
    describe("when a reply names the opposite verb to the pinned list", () => {
        it("should not do the opposite of what was asked", async () => {
            // arrange - two mutes are in force and an unmute list is awaiting a reply
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute all"));
            await sut.handleMessage(messageFrom("unmute"));
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);

            // act - the user asks to mute, not to unmute
            await sut.handleMessage(messageFrom("mute 1"));

            // assert - nothing may be un-silenced by a request to silence
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);
            expect(lastReply()).not.toContain("Lifted");
        });
    });

    describe("after the ai service has acted on a pinned list", () => {
        it("should clear the list, so the next message is not swallowed by it", async () => {
            // arrange
            const sut = getSut(
                twoAlerts,
                {},
                resolverReturning({ action: IntentAction.Mute, numbers: [1] }));
            await sut.handleMessage(messageFrom("mute"));

            // act - free text the ai resolves to a mute of the first alert
            await sut.handleMessage(messageFrom("silence the web one"));

            // assert - a bare "2" afterwards must not resolve against the spent list
            expect(sut.hasPendingSelection("C1", "100.000100", "U1")).toEqual(false);
            await sut.handleMessage(messageFrom("2"));
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(mutes.some(x => x.match.includes("db-01"))).toEqual(false);
        });
    });

    describe("when a list has expired", () => {
        it("should say so rather than claiming not to understand", async () => {
            // arrange
            const sut = getSut(twoAlerts, { "selection-ttl": "1s" });
            await sut.handleMessage(messageFrom("mute"));
            await new Promise(resolve => setTimeout(resolve, 1100));

            // act
            await sut.handleMessage(messageFrom("1"));

            // assert
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
            expect(lastReply()).toContain("expired");
        });
        it("should still be recognised as a reply barky should answer", async () => {
            // arrange - the listener only handles unaddressed thread replies when barky is waiting
            const sut = getSut(twoAlerts, { "selection-ttl": "1s" });
            await sut.handleMessage(messageFrom("mute"));
            await new Promise(resolve => setTimeout(resolve, 1100));

            // act & assert
            expect(sut.hasPendingSelection("C1", "100.000100", "U1")).toEqual(true);
        });
    });

    describe("when lists are requested and never answered", () => {
        it("should clear them out on later activity, rather than holding them for the life of the process", async () => {
            // arrange - a store whose grace period has effectively already passed
            const store = new SelectionStore(1000, 0);
            const sut = new ChatOpsService(
                new ChatOpsConfig({ enabled: true, "app-token": "x" }),
                getApi(),
                getAlertSource(twoAlerts),
                null,
                store);
            for (let i = 0; i < 5; i++) {
                await sut.handleMessage(messageFrom("mute", { userId: `U${ i }`, ts: `10${ i }.000100` }));
            }
            expect(sut.pendingSelectionCount).toEqual(5);
            await new Promise(resolve => setTimeout(resolve, 1100));

            // act
            await sut.handleMessage(messageFrom("status", { userId: "U9", ts: "999.000100" }));

            // assert - the abandoned lists are gone, only the sweep could have removed them
            expect(sut.pendingSelectionCount).toEqual(0);
        });
    });

    describe("when more mutes are in force than will fit in a message", () => {
        it("should describe them as mutes, not as active alerts", async () => {
            // arrange
            const sut = getSut(manyLongIds(60));
            await sut.handleMessage(messageFrom("mute all"));

            // act
            await sut.handleMessage(messageFrom("unmute"));

            // assert
            expect(lastReply()).not.toContain("active alerts");
            expect(lastReply()).toContain("mutes in force");
            expect(lastReply()).toContain("`unmute all`");
        });
    });
    describe("warmUp", () => {
        it("should resolve the ai model up front", async () => {
            // arrange
            const warmed = { count: 0 };
            const resolver: IIntentResolver = {
                resolve: async () => null,
                warmUp: async () => {
                    warmed.count++;
                }
            };
            const sut = getSut(twoAlerts, {}, resolver);

            // act
            await sut.warmUp();

            // assert
            expect(warmed.count).toEqual(1);
        });
        describe("when the model cannot be resolved", () => {
            it("should not throw, so chat ops still starts", async () => {
                // arrange
                const resolver: IIntentResolver = {
                    resolve: async () => null,
                    warmUp: async () => {
                        throw new AiUnavailableError("down");
                    }
                };
                const sut = getSut(twoAlerts, {}, resolver);

                // act & assert
                await expect(sut.warmUp()).resolves.toBeUndefined();
            });
        });
        describe("with no ai configured", () => {
            it("should do nothing", async () => {
                await expect(getSut(twoAlerts).warmUp()).resolves.toBeUndefined();
            });
        });
    });
});
