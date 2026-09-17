import mockConsole from "jest-mock-console";
import { ChatOpsService, IAlertSource, IChatMessage, IChatOpsDependencies } from "./chatops.service.js";
import { IDefinition, IDefinitionSource } from "./definitions.js";
import { IPermalinkSource } from "./permalink.js";
import { AiUnavailableError, IIntent, IIntentContext, IIntentResolver, IntentAction } from "./ai/types.js";
import { ChatOpsConfig } from "./config.js";
import { ISelectionCandidate, SelectionStore } from "./selection.js";
import { SlackMaxMessageLength } from "../models/channels/slack-api.js";
import { SlackApi } from "../models/channels/slack-api.js";
import { Muter } from "../muter.js";
import { deleteDbIfExists, destroy, getChatOpsAudit, initConnection, recordChatThread } from "../models/db.js";
import { dayOfWeek, initLocaleAndTimezone, toLocalDateAndTime } from "../lib/utility.js";
import { singleton } from "../lib/singleton.js";

describe("ChatOpsService", () => {

    const testDb = "dbchatops";
    let restoreConsole;
    let posted: { channel: string, text: string, threadTs: string }[];
    let reactions: string[];
    let grantedScopes: string[];
    let userNames: Record<string, string>;

    beforeEach(async () => {
        restoreConsole = mockConsole();
        deleteDbIfExists(testDb);
        await initConnection(testDb);
        initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
        posted = [];
        reactions = [];
        grantedScopes = ["chat:write", "app_mentions:read", "channels:history", "reactions:write"];
        userNames = { U1: "Rohland" };
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
            },
            getGrantedScopes: async () => grantedScopes,
            getUserName: async (userId: string) => userNames[userId] ?? null
        } as unknown as SlackApi;
    }

    function getAlertSource(ids: string[]): IAlertSource {
        return {
            getActiveAlerts: async (): Promise<ISelectionCandidate[]> =>
                ids.map(id => ({ id, title: id, detail: "failed" }))
        };
    }

    function getSut(
        ids: string[],
        config: any = {},
        resolver: IIntentResolver = null,
        dependencies: Partial<IChatOpsDependencies> = {}) {
        return new ChatOpsService(
            new ChatOpsConfig({ enabled: true, "app-token": "x", ...config }),
            getApi(),
            { alerts: getAlertSource(ids), resolver, ...dependencies });
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
                expect(sut.pendingSelectionCount).toEqual(0);
            });
            describe("and the user asks to mute all", () => {
                it("should mute them regardless, since that needs no list", async () => {
                    // arrange
                    const ids = manyLongIds(60);
                    const sut = getSut(ids);

                    // act
                    await sut.handleMessage(messageFrom("mute all"));

                    // assert
                    expect(lastReply()).toContain("Muting until");
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
                    { alerts });
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
                    { alerts });
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
                // and says why, rather than pretending the answer was unreadable
                expect(lastReply()).toContain("haven't got one waiting for you");
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
            expect(lastReply()).toContain("Lifting 1 mute");
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
        describe("when barky can interpret free text", () => {
            it("should say so, since nothing else advertises it", async () => {
                const sut = getSut([], {}, resolverReturning({}));
                await sut.handleMessage(messageFrom("help"));
                expect(lastReply()).toContain("in your own words");
            });
        });
        describe("when barky cannot interpret free text", () => {
            it("should not offer it", async () => {
                const sut = getSut([]);
                await sut.handleMessage(messageFrom("help"));
                expect(lastReply()).not.toContain("in your own words");
            });
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
                { alerts });

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
                expect(lastReply()).toContain("Muting until");
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
                describe("and another alert that message reported comes back in the meantime", () => {
                    it("should leave it out of the mute, and say so", async () => {
                        // arrange - the thread reported three alerts, one of which had recovered
                        // by the time the list was drawn and fires again before the reply. "all"
                        // has to mean the two that were on screen, and the third has to be named
                        const ids = [...twoAlerts];
                        const alerts: IAlertSource = {
                            getActiveAlerts: async () => ids.map(id => ({ id, title: id, detail: "failed" }))
                        };
                        const sut = new ChatOpsService(
                            new ChatOpsConfig({ enabled: true, "app-token": "x" }),
                            getApi(),
                            { alerts });
                        await recordChatThread({
                            channel: "C1",
                            threadTs,
                            alertIds: [...twoAlerts, "web::health::flapping.com"]
                        });
                        await sut.handleMessage(threadMessage("mute"));
                        ids.push("web::health::flapping.com");

                        // act
                        await sut.handleMessage(threadMessage("all"));

                        // assert
                        const mutes = await Muter.getInstance().getDynamicMutes();
                        expect(mutes).toHaveLength(2);
                        expect(mutes.some(x => x.match.includes("flapping"))).toEqual(false);
                        expect(lastReply()).toContain("fired after that list was drawn");
                    });
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
            expect(audit[0].userName).toEqual("Rohland");
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
            expect(sut.pendingSelectionCount).toEqual(0);
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
        it("should be kept long enough to answer a late reply, not dropped on expiry", async () => {
            // arrange
            const sut = getSut(twoAlerts, { "selection-ttl": "1s" });
            await sut.handleMessage(messageFrom("mute"));
            await new Promise(resolve => setTimeout(resolve, 1100));

            // act & assert
            expect(sut.pendingSelectionCount).toEqual(1);
        });
    });

    describe("when lists are requested and never answered", () => {
        it("should clear them out on later activity, rather than holding them for the life of the process", async () => {
            // arrange - a store whose grace period has effectively already passed
            const store = new SelectionStore(1000, 0);
            const sut = new ChatOpsService(
                new ChatOpsConfig({ enabled: true, "app-token": "x" }),
                getApi(),
                { alerts: getAlertSource(twoAlerts), selections: store });
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
    describe("when an expiry cannot be honoured", () => {
        it.each([
            ["not-a-date"],
            ["2020-01-01 08:00"]
        ])("should mute for the default and say so, given '%s'", async (until) => {
            // arrange - silently applying a substantially different expiry would hide the problem
            const sut = getSut(
                twoAlerts,
                {},
                resolverReturning({ action: IntentAction.Mute, numbers: [1], until }));

            // act
            await sut.handleMessage(messageFrom("mute the web one until whenever"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(mutes).toHaveLength(1);
            expect(lastReply()).toContain("couldn't make sense of");
            expect(lastReply()).toContain(until);
        });
        describe("when no expiry was asked for at all", () => {
            it("should say nothing about it", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("mute"));
                await sut.handleMessage(messageFrom("1"));
                expect(lastReply()).not.toContain("couldn't make sense of");
            });
        });
    });

    describe("every reply barky posts", () => {
        it("should fit inside a slack message, not just the numbered lists", async () => {
            // arrange - muting a large set produces an outcome listing every one of them
            const ids = manyLongIds(80);
            const sut = getSut(ids);

            // act
            await sut.handleMessage(messageFrom("mute all"));

            // assert
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(80);
            expect(posted[posted.length - 1].text.length).toBeLessThanOrEqual(SlackMaxMessageLength);
        });
        it("should fit when reporting status too", async () => {
            const sut = getSut(manyLongIds(80));
            await sut.handleMessage(messageFrom("status"));
            expect(posted[posted.length - 1].text.length).toBeLessThanOrEqual(SlackMaxMessageLength);
        });
    });

    describe("muting a set", () => {
        it("should persist them in one operation", async () => {
            // arrange - a partial failure would silence some alerts while reporting that nothing
            // changed, so the whole set is written at once
            const inserts = { count: 0 };
            const muter = Muter.getInstance();
            const original = muter.registerMutes.bind(muter);
            (muter as any).registerMutes = async (...args: any[]) => {
                inserts.count++;
                return await (original as any)(...args);
            };
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(messageFrom("mute all"));

            // assert
            expect(inserts.count).toEqual(1);
            expect(await muter.getDynamicMutes()).toHaveLength(2);
            (muter as any).registerMutes = original;
        });
    });
    describe("verifyScopes", () => {
        describe("when the app can read mentions and history", () => {
            it("should report nothing missing", async () => {
                const sut = getSut(twoAlerts);
                expect(await sut.verifyScopes()).toEqual([]);
            });
        });
        describe("when the app was only ever set up to post alerts", () => {
            it("should name the scopes that stop it receiving replies", async () => {
                // arrange - exactly the scopes a post-only alerting app is given
                grantedScopes = ["incoming-webhook", "chat:write", "reactions:write"];
                const sut = getSut(twoAlerts);

                // act
                const missing = await sut.verifyScopes();

                // assert
                expect(missing).toContain("app_mentions:read");
                expect(missing.join(" ")).toContain("channels:history");
            });
        });
        describe("in a private channel", () => {
            it("should accept groups:history in place of channels:history", async () => {
                grantedScopes = ["chat:write", "app_mentions:read", "groups:history"];
                const sut = getSut(twoAlerts);
                expect(await sut.verifyScopes()).toEqual([]);
            });
        });
        describe("when the scopes cannot be determined", () => {
            it("should say nothing rather than warn wrongly", async () => {
                grantedScopes = null;
                const sut = getSut(twoAlerts);
                expect(await sut.verifyScopes()).toEqual([]);
            });
        });
    });
    describe("warming up", () => {
        it("should check the scopes even with no ai configured", async () => {
            grantedScopes = ["chat:write"];
            const sut = getSut(twoAlerts);
            await sut.warmUp();
            expect(await sut.verifyScopes()).toContain("app_mentions:read");
        });
    });
    describe("the outcome of a mute", () => {
        it("should say it is muting, not that it already has", async () => {
            // arrange - the window is written now but only applied when the next evaluation
            // reloads it, so claiming it is already in force would be wrong
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("1"));

            // assert
            expect(lastReply()).toContain("Muting until");
            expect(lastReply()).toContain("next evaluation");
        });
        it("should say the same when lifting a mute", async () => {
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute all"));
            await sut.handleMessage(messageFrom("unmute all"));
            expect(lastReply()).toContain("Lifting");
            expect(lastReply()).toContain("next evaluation");
        });
    });

    describe("who the log records", () => {
        it("should record the display name alongside the id", async () => {
            // arrange
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(messageFrom("mute all", { userId: "U1" }));

            // assert
            const audit = await getChatOpsAudit();
            expect(audit[0].userName).toEqual("Rohland");
            expect(audit[0].userId).toEqual("U1");
        });
        describe("when the name cannot be resolved", () => {
            it("should still record the action, with no name", async () => {
                // arrange - users:read is optional, and its absence must not lose the audit entry
                userNames = {};
                const sut = getSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("mute all", { userId: "U9" }));

                // assert
                const audit = await getChatOpsAudit();
                expect(audit).toHaveLength(1);
                expect(audit[0].userName).toBeNull();
                expect(audit[0].userId).toEqual("U9");
            });
        });
    });
    describe("when the answer to a list is a polite one", () => {
        it("should act on it rather than telling the user off", async () => {
            // arrange - "mute for 1 hour", the list, then "all please". With no ai configured the
            // local parser is all there is, and the courtesy must not be what breaks it
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute for 1 hour"));

            // act
            await sut.handleMessage(messageFrom("all please"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(mutes).toHaveLength(2);
            const oneHour = 60 * 60 * 1000;
            expect(Math.abs(mutes[0].to.getTime() - (Date.now() + oneHour))).toBeLessThan(5000);
        });
    });

    describe("when an answer arrives for a list barky no longer has", () => {
        it("should say so, rather than that it did not understand", async () => {
            // arrange - the lists live in memory, so a restart takes them with it. Being told the
            // answer was unreadable when it is exactly what was asked for is baffling
            const sut = getSut(twoAlerts);

            // act - "all" with nothing pinned, as after a restart
            await sut.handleMessage(messageFrom("all"));

            // assert
            expect(lastReply()).toContain("haven't got one waiting for you");
            expect(lastReply()).toContain("`mute`");
            expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(0);
        });
        describe("and it is a plain command rather than an answer", () => {
            it("should carry on as normal", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("mute all"));
                expect(await Muter.getInstance().getDynamicMutes()).toHaveLength(2);
            });
        });
    });

    describe("when a list is waiting and the reply cannot be read", () => {
        it("should point back at the list, not at the commands", async () => {
            // arrange - being told to try `mute` halfway through muting reads as barky having
            // lost the thread
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("the mysql ones"));

            // assert
            expect(lastReply()).toContain("which of those you meant");
            expect(lastReply()).toContain("`all`");
            expect(lastReply()).not.toContain("Try `mute`");
            // and the list is still pinned, so the next answer still lands
            expect(sut.pendingSelectionCount).toEqual(1);
        });
        describe("with no list waiting", () => {
            it("should offer the commands", async () => {
                const sut = getSut(twoAlerts);
                await sut.handleMessage(messageFrom("the mysql ones"));
                expect(lastReply()).toContain("Try `mute`");
            });
            it("should offer every command, not only the ones that change something", async () => {
                // arrange - a command left out here is a command nobody finds
                const sut = getSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("the mysql ones"));

                // assert
                ["`mute`", "`unmute`", "`define`", "`status`", "`help`"]
                    .forEach(command => expect(lastReply()).toContain(command));
            });
        });
    });

    describe("when a period is given before barky asks which alerts", () => {
        it("should still apply it after the answer", async () => {
            // arrange - "mute for 1 hour", then a list, then "all": the hour must survive
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute for 1 hour"));

            // act
            await sut.handleMessage(messageFrom("all"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(mutes).toHaveLength(2);
            const oneHour = 60 * 60 * 1000;
            expect(Math.abs(mutes[0].to.getTime() - (Date.now() + oneHour))).toBeLessThan(5000);
        });
        it("should say which expiry it is going to use when it asks", async () => {
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute for 1 hour"));
            expect(lastReply()).toContain("as you asked");
            expect(lastReply()).not.toContain("the default of");
        });
        it("should let the answer override it", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute for 1 hour"));

            // act
            await sut.handleMessage(messageFrom("1 for 4h"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            const fourHours = 4 * 60 * 60 * 1000;
            expect(Math.abs(mutes[0].to.getTime() - (Date.now() + fourHours))).toBeLessThan(5000);
        });
        it("should carry a period the ai read, through the list it asks barky for", async () => {
            // arrange - "silence the noisy ones for 4 hours" names a period but not which alerts,
            // so the ai asks for the list. The period was said once and must survive the detour
            const sut = getSut(
                twoAlerts,
                {},
                resolverReturning({ action: IntentAction.RequestMuteList, duration: "4h" }));
            await sut.handleMessage(messageFrom("silence the noisy ones for 4 hours"));
            expect(lastReply()).toContain("as you asked");

            // act
            await sut.handleMessage(messageFrom("all"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            const fourHours = 4 * 60 * 60 * 1000;
            expect(Math.abs(mutes[0].to.getTime() - (Date.now() + fourHours))).toBeLessThan(5000);
        });
        it("should apply it through the ai path too", async () => {
            // arrange
            const sut = getSut(
                twoAlerts,
                {},
                resolverReturning({ action: IntentAction.Select, numbers: [1] }));
            await sut.handleMessage(messageFrom("mute for 1 hour"));

            // act - free text the ai resolves to a selection, naming no period of its own
            await sut.handleMessage(messageFrom("just the first one thanks"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            const oneHour = 60 * 60 * 1000;
            expect(Math.abs(mutes[0].to.getTime() - (Date.now() + oneHour))).toBeLessThan(5000);
        });
    });

    describe("when no period is given", () => {
        it("should offer the default in the prompt", async () => {
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));
            expect(lastReply()).toContain("the default of");
            expect(lastReply()).not.toContain("as you asked");
        });
    });
    describe("muting until a named day", () => {
        it("should mute until tomorrow morning", async () => {
            // arrange
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(messageFrom("mute all until tomorrow"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            const local = toLocalDateAndTime(mutes[0].to);
            expect(local.time).toEqual("08:00");
            expect(mutes[0].to.getTime()).toBeGreaterThan(Date.now());
        });
        it("should survive the detour through a list", async () => {
            // arrange - "mute until monday" is ambiguous about which alerts, so a list is raised
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute until monday"));
            const prompt = lastReply();

            // act
            await sut.handleMessage(messageFrom("all"));

            // assert - the day asked for is applied, not the default
            expect(prompt).toContain("as you asked");
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(toLocalDateAndTime(mutes[0].to).time).toEqual("08:00");
            expect(dayOfWeek(mutes[0].to)).toEqual(1);
        });
        it("should let a reply name the day instead", async () => {
            // arrange
            const sut = getSut(twoAlerts);
            await sut.handleMessage(messageFrom("mute"));

            // act
            await sut.handleMessage(messageFrom("all until thursday"));

            // assert
            const mutes = await Muter.getInstance().getDynamicMutes();
            expect(dayOfWeek(mutes[0].to)).toEqual(4);
        });
        describe("when the day asked for is beyond the maximum mute", () => {
            it("should be capped", async () => {
                // arrange
                const sut = getSut(twoAlerts, { "max-mute": "2h" });

                // act
                await sut.handleMessage(messageFrom("mute all until monday"));

                // assert
                const mutes = await Muter.getInstance().getDynamicMutes();
                const twoHours = 2 * 60 * 60 * 1000;
                expect(Math.abs(mutes[0].to.getTime() - (Date.now() + twoHours))).toBeLessThan(5000);
            });
        });
    });

    describe("when mentioned in the thread of a follow-up ping", () => {

        const pointsTo = { url: "https://codeo.slack.com/archives/C1/p1699999999000100" };

        function pingMessage(text: string) {
            return messageFrom(text, {
                ts: "1700000000.000200",
                threadTs: "1699999999.000900",
                pointsTo
            });
        }

        it("should answer, rather than leaving the mention unanswered", async () => {
            // arrange - silence here is indistinguishable from barky having stopped working
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(pingMessage("mute for 1hr"));

            // assert
            expect(posted).toHaveLength(1);
            expect(lastReply()).toContain(`<${ pointsTo.url }|the alert's own thread>`);
            expect(lastReply()).toContain("I repost this message every time I check");
        });
        it("should reply in the thread it was asked in", async () => {
            // arrange
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(pingMessage("mute for 1hr"));

            // assert
            expect(posted[0].threadTs).toEqual("1699999999.000900");
        });
        it("should change nothing, since the answer would be deleted with the message", async () => {
            // arrange - "mute all" needs no list, so without this it would silence everything and
            // confirm it in a message barky is about to repost over
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(pingMessage("mute all"));

            // assert
            expect(await Muter.getInstance().getDynamicMutes()).toEqual([]);
            expect(await getChatOpsAudit()).toEqual([]);
        });
        it("should not pin a list there either", async () => {
            // arrange
            const sut = getSut(twoAlerts);

            // act
            await sut.handleMessage(pingMessage("mute"));

            // assert
            expect(sut.pendingSelectionCount).toEqual(0);
        });
        it("should not spend an ai call on it", async () => {
            // arrange
            const context: { value?: any } = {};
            const sut = getSut(twoAlerts, {}, resolverCapturing(context, {}));

            // act
            await sut.handleMessage(pingMessage("please silence the noisy database one"));

            // assert
            expect(context.value).toBeUndefined();
            expect(lastReply()).toContain("the alert's own thread");
        });
        describe("where there is no link to give", () => {
            it("should still say where to go", async () => {
                // arrange - the channel configures no workspace to build a url from
                const sut = getSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("mute", {
                    ts: "1700000000.000200",
                    threadTs: "1699999999.000900",
                    pointsTo: { url: null }
                }));

                // assert
                expect(lastReply()).toContain("the alert's own thread");
            });
        });
    });

    describe("define", () => {

        const threadTs = "1699999999.000100";
        let asked: string[];
        let linked: string[];

        beforeEach(() => {
            asked = [];
            linked = [];
        });

        function definitionFor(alertId: string, yaml: string): IDefinition {
            const type = alertId.split("::")[0];
            return {
                alertId,
                key: alertId.split("::")[1],
                type,
                filePath: `/repo/configs/${ type }.yaml`,
                displayPath: `configs/${ type }.yaml`,
                yaml,
                firstLine: 8,
                lastLine: 8 + yaml.split("\n").length - 1,
                redacted: 0
            };
        }

        function definitions(blocks: Record<string, string>): IDefinitionSource {
            return {
                find: (alertId: string) => {
                    asked.push(alertId);
                    return blocks[alertId]
                        ? definitionFor(alertId, blocks[alertId])
                        : null;
                }
            };
        }

        function permalinks(url: string): IPermalinkSource {
            return {
                forDefinition: async (definition: IDefinition) => {
                    linked.push(definition.alertId);
                    return url;
                }
            };
        }

        const blocks = {
            "web::health::a.com": "a.com:\n  url: https://a.com\n  status: 200",
            "mysql::lag::db-01": "lag:\n  connection: db-01\n  identifier: replica"
        };

        function longBlock(lines: number): string {
            return Array.from(
                { length: lines },
                (_, i) => `  option-${ i }: a value long enough to matter when there are many`)
                .join("\n");
        }

        function getDefineSut(
            ids: string[],
            blocksToUse: Record<string, string> = blocks,
            options: { permalink?: string, config?: any, resolver?: IIntentResolver } = {}) {
            return getSut(
                ids,
                options.config ?? {},
                options.resolver ?? null,
                {
                    definitions: definitions(blocksToUse),
                    permalinks: permalinks(options.permalink ?? null)
                });
        }

        describe("asking for a definition", () => {
            it("should offer the numbered list of active alerts", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(lastReply()).toContain("2 active alerts");
                expect(lastReply()).toContain("`1.` web::health::a.com");
                expect(lastReply()).toContain("the number you want the configuration for");
                expect(sut.pendingSelectionCount).toEqual(1);
            });
            it("should not read any configuration until it is told which", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(asked).toEqual([]);
            });
            describe("when only one alert is active", () => {
                it("should answer straight away rather than offering a list of one", async () => {
                    // arrange
                    const sut = getDefineSut(["web::health::a.com"]);

                    // act
                    await sut.handleMessage(messageFrom("define"));

                    // assert
                    expect(lastReply()).toContain("`web::health::a.com`");
                    expect(lastReply()).toContain("url: https://a.com");
                    expect(sut.pendingSelectionCount).toEqual(0);
                });
            });
            describe("when nothing is alerting", () => {
                it("should say so", async () => {
                    // arrange
                    const sut = getDefineSut([]);

                    // act
                    await sut.handleMessage(messageFrom("define"));

                    // assert
                    expect(lastReply()).toContain("Nothing is alerting right now");
                });
            });
            describe("when barky has no rules to read", () => {
                it("should say so rather than failing", async () => {
                    // arrange - no definition source, which is the only state it cannot answer in
                    const sut = getSut(twoAlerts, { "dashboard-url": "https://barky.acme.com" });

                    // act
                    await sut.handleMessage(messageFrom("define"));

                    // assert
                    expect(lastReply()).toContain("can't read the rules file");
                    expect(lastReply()).toContain("https://barky.acme.com");
                });
            });
        });

        describe("answering the list", () => {
            it("should post the block declaring the alert chosen", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts);
                await sut.handleMessage(messageFrom("define"));

                // act
                await sut.handleMessage(messageFrom("2"));

                // assert
                expect(asked).toEqual(["mysql::lag::db-01"]);
                expect(lastReply()).toContain("`mysql::lag::db-01`");
                expect(lastReply()).toContain("defined in `configs/mysql.yaml`");
                expect(lastReply()).toContain("```\nlag:\n  connection: db-01\n  identifier: replica\n```");
            });
            it("should take the list down once it has answered", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts);
                await sut.handleMessage(messageFrom("define"));

                // act
                await sut.handleMessage(messageFrom("2"));

                // assert
                expect(sut.pendingSelectionCount).toEqual(0);
            });
            it("should change nothing", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts);
                await sut.handleMessage(messageFrom("define"));

                // act
                await sut.handleMessage(messageFrom("1"));

                // assert
                expect(await Muter.getInstance().getDynamicMutes()).toEqual([]);
            });
            it("should record who asked", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts);
                await sut.handleMessage(messageFrom("define"));

                // act
                await sut.handleMessage(messageFrom("1"));

                // assert
                const audit = await getChatOpsAudit();
                expect(audit).toHaveLength(1);
                expect(audit[0].action).toEqual("define");
                expect(audit[0].userName).toEqual("Rohland");
                expect(audit[0].detail.alerts).toEqual(["web::health::a.com"]);
            });
            describe("when the answer names more than one", () => {
                it("should show none of them, since it posts one at a time", async () => {
                    // arrange
                    const sut = getDefineSut(twoAlerts);
                    await sut.handleMessage(messageFrom("define"));

                    // act
                    await sut.handleMessage(messageFrom("1,2"));

                    // assert
                    expect(lastReply()).toContain("one definition at a time");
                    expect(asked).toEqual([]);
                });
                it("should leave the list up for the one they meant", async () => {
                    // arrange
                    const sut = getDefineSut(twoAlerts);
                    await sut.handleMessage(messageFrom("define"));

                    // act
                    await sut.handleMessage(messageFrom("1,2"));
                    await sut.handleMessage(messageFrom("2"));

                    // assert
                    expect(asked).toEqual(["mysql::lag::db-01"]);
                    expect(lastReply()).toContain("`mysql::lag::db-01`");
                });
                it("should refuse all of them the same way", async () => {
                    // arrange
                    const sut = getDefineSut(twoAlerts);
                    await sut.handleMessage(messageFrom("define"));

                    // act
                    await sut.handleMessage(messageFrom("all"));

                    // assert
                    expect(lastReply()).toContain("one definition at a time");
                    expect(sut.pendingSelectionCount).toEqual(1);
                });
            });
            describe("when the answer is out of range", () => {
                it("should say so rather than reading anything", async () => {
                    // arrange
                    const sut = getDefineSut(twoAlerts);
                    await sut.handleMessage(messageFrom("define"));

                    // act
                    await sut.handleMessage(messageFrom("5"));

                    // assert
                    expect(lastReply()).toContain("no item numbered 5");
                    expect(asked).toEqual([]);
                });
            });
            describe("when the reply asks to mute instead", () => {
                it("should not act on the definition list", async () => {
                    // arrange - "mute 1" is not an answer to "which of these shall I explain?"
                    const sut = getDefineSut(twoAlerts);
                    await sut.handleMessage(messageFrom("define"));

                    // act
                    await sut.handleMessage(messageFrom("mute 1"));

                    // assert
                    expect(await Muter.getInstance().getDynamicMutes()).toEqual([]);
                    expect(asked).toEqual([]);
                    expect(lastReply()).toContain("didn't catch which of those you meant");
                });
            });
        });

        describe("inside an alert's own thread", () => {
            it("should answer for that alert without offering a list", async () => {
                // arrange
                await recordChatThread({
                    channel: "C1",
                    threadTs,
                    alertIds: ["mysql::lag::db-01"]
                });
                const sut = getDefineSut(twoAlerts);

                // act
                await sut.handleMessage(messageFrom("define", { ts: "1700000000.000200", threadTs }));

                // assert
                expect(asked).toEqual(["mysql::lag::db-01"]);
                expect(lastReply()).toContain("`mysql::lag::db-01`");
                expect(sut.pendingSelectionCount).toEqual(0);
            });
        });

        describe("a block too long for one message", () => {
            it("should carry a link to the rest of it", async () => {
                // arrange
                const url = "https://github.com/acme/widgets/blob/abc123/configs/web.yaml#L8-L207";
                const sut = getDefineSut(
                    ["web::health::a.com"],
                    { "web::health::a.com": longBlock(200) },
                    { permalink: url });

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(linked).toEqual(["web::health::a.com"]);
                expect(lastReply()).toContain(`<${ url }|see all 200 lines on github>`);
                expect(lastReply().length).toBeLessThanOrEqual(SlackMaxMessageLength);
            });
            it("should point at the file where no link could be built", async () => {
                // arrange - no git, not a checkout, or a commit no remote has yet
                const sut = getDefineSut(
                    ["web::health::a.com"],
                    { "web::health::a.com": longBlock(200) },
                    { permalink: null });

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(linked).toEqual(["web::health::a.com"]);
                expect(lastReply()).toContain("the rest is in `configs/web.yaml` from line 8");
            });
        });

        describe("a block that fits", () => {
            it("should not go looking for a link", async () => {
                // arrange - a link costs a couple of git calls, and is not needed here
                const sut = getDefineSut(["web::health::a.com"]);

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(linked).toEqual([]);
            });
        });

        describe("an alert the rules no longer declare", () => {
            it("should say it cannot find it rather than guessing", async () => {
                // arrange
                const sut = getDefineSut(
                    ["web::health::gone.com"],
                    {},
                    { config: { "dashboard-url": "https://barky.acme.com" } });

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(lastReply()).toContain("can't find `web::health::gone.com`");
                expect(lastReply()).toContain("renamed or removed");
            });
        });

        describe("when the configuration cannot be read", () => {
            it("should say what happened rather than reporting a failure", async () => {
                // arrange
                const sut = getSut(["web::health::a.com"], {}, null, {
                    definitions: {
                        find: () => {
                            throw new Error("yaml is broken");
                        }
                    }
                });

                // act
                await sut.handleMessage(messageFrom("define"));

                // assert
                expect(lastReply()).toContain("couldn't read the configuration");
                expect(lastReply()).toContain("Nothing else was affected");
            });
        });

        describe("when the request is interpreted", () => {
            it("should answer for the alert the model chose", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts, blocks, {
                    resolver: resolverReturning({ action: IntentAction.Define, numbers: [2] })
                });

                // act
                await sut.handleMessage(messageFrom("what does the db one actually check?"));

                // assert
                expect(asked).toEqual(["mysql::lag::db-01"]);
                expect(lastReply()).toContain("`mysql::lag::db-01`");
            });
            it("should offer the list where the model named none", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts, blocks, {
                    resolver: resolverReturning({ action: IntentAction.RequestDefineList })
                });

                // act
                await sut.handleMessage(messageFrom("how is this lot configured?"));

                // assert
                expect(lastReply()).toContain("the number you want the configuration for");
                expect(sut.pendingSelectionCount).toEqual(1);
            });
            it("should refuse more than one without taking the list down", async () => {
                // arrange
                const sut = getDefineSut(twoAlerts, blocks, {
                    resolver: resolverReturning({ action: IntentAction.Define, numbers: [1, 2] })
                });
                await sut.handleMessage(messageFrom("define"));

                // act
                await sut.handleMessage(messageFrom("both of them please"));

                // assert
                expect(lastReply()).toContain("one definition at a time");
                expect(sut.pendingSelectionCount).toEqual(1);
            });
        });
    });
});
