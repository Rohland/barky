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
            it("should retry and then throw", async () => {
                // arrange
                mockResponse({ error: "channel_not_found" });
                const sut = new SlackApi("token");

                // act
                let caught = null;
                try {
                    await sut.postMessage("#nope", "hello");
                } catch (err) {
                    caught = err;
                }

                // assert
                expect(caught).not.toBeNull();
                expect(caught.message).toContain("after 3 attempts");
                expect(axios.request).toHaveBeenCalledTimes(3);
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
});
