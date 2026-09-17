import { ChatOpsRouter } from "./router.js";
import { ChatOpsService } from "./chatops.service.js";
import { IChatThread } from "../models/db.js";

describe("ChatOpsRouter", () => {

    const primary = { name: "primary" } as unknown as ChatOpsService;
    const db = { name: "db" } as unknown as ChatOpsService;

    function threadIn(channelName?: string): IChatThread {
        return {
            channel: "C1",
            threadTs: "1700000000.000100",
            alertIds: ["mysql::lag::db-01"],
            channelName
        };
    }

    function getSut() {
        return new ChatOpsRouter(primary, new Map([["slack-db", db]]));
    }

    describe("serviceFor", () => {
        describe("when the thread names a channel the app answers in", () => {
            it("should answer with that channel's service", () => {
                expect(getSut().serviceFor(threadIn("slack-db"))).toBe(db);
            });
            it("should not care how the channel was cased", () => {
                // arrange - the digest is read as written, and matching is on the config name
                expect(getSut().serviceFor(threadIn("Slack-DB"))).toBe(db);
            });
        });

        describe("when the thread names a channel the app no longer answers in", () => {
            it("should route it nowhere, rather than to another channel's install", () => {
                // arrange - a channel opted out of chat ops keeps its recorded threads for the
                // retention window, and answering one would mute from a channel that has been
                // switched off, with a token that may not even be able to post the reply
                expect(getSut().serviceFor(threadIn("slack-was-removed"))).toBeNull();
            });
        });

        describe("when the thread names no channel", () => {
            it.each([
                [undefined],
                [null],
                [""]
            ])("should fall back to the channel that declared chat ops", (channelName) => {
                // arrange - rows written before barky tracked which channel posted them
                expect(getSut().serviceFor(threadIn(channelName))).toBe(primary);
            });
        });

        describe("when there is no thread", () => {
            it("should not throw", () => {
                expect(getSut().serviceFor(null)).toBe(primary);
            });
        });
    });

    describe("services", () => {
        it("should list each one once, however many channels share it", () => {
            const sut = new ChatOpsRouter(primary, new Map([
                ["slack-ops", primary],
                ["slack-db", db],
                ["slack-api", db]
            ]));
            expect(sut.services).toEqual([primary, db]);
        });
    });
});
