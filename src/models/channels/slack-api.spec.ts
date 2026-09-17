import axios from "axios";
import mockConsole from "jest-mock-console";
import { SlackApi } from "./slack-api.js";

describe("SlackApi", () => {

    let restoreConsole;

    beforeEach(() => {
        restoreConsole = mockConsole();
    });

    afterEach(() => {
        restoreConsole();
    });

    function mockResponse(data: any) {
        return jest
            .spyOn(axios, "request")
            .mockResolvedValue({ data } as any);
    }

    function getRequestBody(spy: any, call: number = 0) {
        return JSON.parse(spy.mock.calls[call][0].data);
    }

    function getRequestUrl(spy: any, call: number = 0) {
        return spy.mock.calls[call][0].url;
    }

    describe("postMessage", () => {
        it("should post the message and return the resulting reference", async () => {
            // arrange
            const spy = mockResponse({ channel: "C123", ts: "1700000000.123" });
            const sut = new SlackApi("token");

            // act
            const result = await sut.postMessage("#ops", "hello");

            // assert
            expect(getRequestUrl(spy)).toEqual("https://slack.com/api/chat.postMessage");
            expect(getRequestBody(spy)).toEqual({
                channel: "#ops",
                text: "hello",
                unfurl_links: false
            });
            expect(spy.mock.calls[0][0].headers.Authorization).toEqual("Bearer token");
            expect(result).toEqual({ channel: "C123", ts: "1700000000.123" });
        });
        describe("when given a thread", () => {
            it("should post as a reply in that thread", async () => {
                // arrange
                const spy = mockResponse({ channel: "C123", ts: "2" });
                const sut = new SlackApi("token");

                // act
                await sut.postMessage("#ops", "hello", 1700000000.123);

                // assert
                expect(getRequestUrl(spy)).toEqual("https://slack.com/api/chat.postMessage");
                expect(getRequestBody(spy).thread_ts).toEqual(1700000000.123);
            });
        });
        describe("when slack returns an error", () => {
            it("should throw, naming the call and the reason slack gave", async () => {
                // arrange - this message is all an operator sees, since the retry log is silent
                // without --debug
                mockResponse({ error: "ratelimited" });
                const sut = new SlackApi("token");

                // act
                let caught = null;
                try {
                    await sut.postMessage("#ops", "hello");
                } catch (err) {
                    caught = err;
                }

                // assert
                expect(caught).not.toBeNull();
                expect(caught.message).toContain("chat.postMessage to #ops");
                expect(caught.message).toContain("ratelimited");
            });
            it("should retry one that asking again could fix", async () => {
                // arrange
                mockResponse({ error: "ratelimited" });
                const sut = new SlackApi("token");

                // act
                await expect(sut.postMessage("#ops", "hello")).rejects.toThrow("after 3 attempts");

                // assert
                expect(axios.request).toHaveBeenCalledTimes(3);
            });
            describe.each([
                ["a channel barky is not in", "not_in_channel"],
                ["a channel that does not exist", "channel_not_found"],
                ["a message slack has no record of", "message_not_found"],
                ["a token that is no longer valid", "invalid_auth"],
                ["text slack will not accept", "msg_too_long"]
            ])("given %s", (_label, error) => {
                it("should not spend three attempts on an answer that will not move", async () => {
                    // arrange
                    mockResponse({ error });
                    const sut = new SlackApi("token");

                    // act
                    await expect(sut.postMessage("#ops", "hello")).rejects.toThrow(error);

                    // assert
                    expect(axios.request).toHaveBeenCalledTimes(1);
                });
            });
        });
    });

    describe("updateMessage", () => {
        it("should update the message in place", async () => {
            // arrange
            const spy = mockResponse({ channel: "C123", ts: "1" });
            const sut = new SlackApi("token");

            // act
            await sut.updateMessage("C123", 1700000000.123, "updated");

            // assert
            expect(getRequestUrl(spy)).toEqual("https://slack.com/api/chat.update");
            expect(getRequestBody(spy)).toEqual({
                channel: "C123",
                ts: 1700000000.123,
                text: "updated",
                unfurl_links: false
            });
        });
    });

    describe("deleteMessage", () => {
        it("should delete the message", async () => {
            // arrange
            const spy = mockResponse({ ok: true });
            const sut = new SlackApi("token");

            // act
            await sut.deleteMessage("C123", 1700000000.123);

            // assert
            expect(getRequestUrl(spy)).toEqual("https://slack.com/api/chat.delete");
            expect(getRequestBody(spy)).toEqual({ channel: "C123", ts: 1700000000.123 });
        });
        describe("when the call fails", () => {
            it("should swallow the error", async () => {
                // arrange - deleting is best effort, a failure must not derail alerting
                jest.spyOn(axios, "request").mockRejectedValue(new Error("boom"));
                const sut = new SlackApi("token");

                // act & assert
                await expect(sut.deleteMessage("C123", 1)).resolves.toBeUndefined();
            });
        });
    });

    describe("addReaction", () => {
        it("should react using the message timestamp", async () => {
            // arrange
            const spy = mockResponse({ ok: true });
            const sut = new SlackApi("token");

            // act
            await sut.addReaction("C123", 1700000000.123, "white_check_mark");

            // assert
            expect(getRequestUrl(spy)).toEqual("https://slack.com/api/reactions.add");
            expect(getRequestBody(spy)).toEqual({
                name: "white_check_mark",
                channel: "C123",
                timestamp: 1700000000.123
            });
        });
        describe("when the call keeps failing", () => {
            it("should give up without throwing", async () => {
                // arrange
                jest.spyOn(axios, "request").mockRejectedValue(new Error("boom"));
                const sut = new SlackApi("token");

                // act & assert
                await expect(sut.addReaction("C123", 1, "eyes")).resolves.toBeUndefined();
                expect(axios.request).toHaveBeenCalledTimes(3);
            });
        });
    });
    describe("getUserName", () => {
        function mockUser(data: any) {
            return jest.spyOn(axios, "request").mockResolvedValue({ data } as any);
        }

        it("should return the display name", async () => {
            const spy = mockUser({ ok: true, user: { profile: { display_name: "rohland", real_name: "Rohland de Charmoy" } } });
            const result = await new SlackApi("token").getUserName("U1");
            expect(spy.mock.calls[0][0].url).toEqual("https://slack.com/api/users.info");
            expect(spy.mock.calls[0][0].params).toEqual({ user: "U1" });
            expect(result).toEqual("rohland");
        });
        describe("when there is no display name", () => {
            it("should fall back through the other names slack offers", async () => {
                mockUser({ ok: true, user: { profile: { real_name: "Rohland de Charmoy" } } });
                expect(await new SlackApi("token").getUserName("U1")).toEqual("Rohland de Charmoy");
                jest.restoreAllMocks();
                mockUser({ ok: true, user: { name: "rohland" } });
                expect(await new SlackApi("token").getUserName("U2")).toEqual("rohland");
            });
        });
        it("should only look a person up once", async () => {
            // arrange - the same few people act repeatedly
            const spy = mockUser({ ok: true, user: { profile: { display_name: "rohland" } } });
            const sut = new SlackApi("token");

            // act
            await sut.getUserName("U1");
            await sut.getUserName("U1");

            // assert
            expect(spy).toHaveBeenCalledTimes(1);
        });
        describe("when the lookup is refused", () => {
            it("should return nothing rather than throwing, since users:read is optional", async () => {
                mockUser({ ok: false, error: "missing_scope" });
                expect(await new SlackApi("token").getUserName("U1")).toBeNull();
            });
            it("should also survive the call failing outright", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(new Error("boom"));
                expect(await new SlackApi("token").getUserName("U1")).toBeNull();
            });
        });
        describe("given no user id", () => {
            it("should not call slack at all", async () => {
                const spy = mockUser({ ok: true });
                expect(await new SlackApi("token").getUserName(null)).toBeNull();
                expect(spy).not.toHaveBeenCalled();
            });
        });
    });
});
