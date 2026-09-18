import { Muter } from "./muter.js";
import { deleteDbIfExists, destroy, initConnection } from "./models/db.js";
import { initLocaleAndTimezone } from "./lib/utility.js";

describe("Muter", () => {

    const testDb = "dbmuter";

    beforeEach(async () => {
        deleteDbIfExists(testDb);
        await initConnection(testDb);
    });
    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
    });

    function getSut() {
        const sut = new Muter();
        // @ts-ignore
        sut.init({ muteWindows: [] });
        return sut;
    }

    describe("with no config", () => {
        it("should not throw", async () => {
            const muter = new Muter();
            await muter.init(null);
        });
    });

    describe("registerMute", () => {
        it("should register the mute and make it available", async () => {
            const sut = getSut();
            const now = new Date();
            now.setHours(10);
            now.setMinutes(20);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(19);
            tomorrow.setMinutes(30);
            await sut.registerMute("test::123", now, tomorrow);
            await sut.loadDynamicMutes();
            expect(sut.muteWindows).toHaveLength(2);
            const mute = sut.muteWindows[0];
            expect(mute.match).toEqual("test::123");
            expect(mute.startTime).toEqual("10:20");
            expect(mute.endTime).toEqual("24:00");
            const mute2 = sut.muteWindows[1];
            expect(mute2.match).toEqual("test::123");
            expect(mute2.startTime).toEqual("00:00");
            expect(mute2.endTime).toEqual("19:30");
        });
    });

    describe("unmute", () => {
        it("should remove mute rules", async () => {
            const sut = getSut();
            const end = new Date();
            end.setMinutes(end.getMinutes() +1);
            await sut.registerMute("test", new Date(), end);
            await sut.loadDynamicMutes();
            expect(sut.muteWindows).toHaveLength(1);
            await sut.unmute(["test"]);
            await sut.loadDynamicMutes();
            expect(sut.muteWindows).toHaveLength(0);
        });
        it("should escape backslashes", async () => {
            const sut = getSut();
            const end = new Date();
            end.setMinutes(end.getMinutes() +1);
            await sut.registerMute("test\\", new Date(), end);
            await sut.loadDynamicMutes();
            expect(sut.muteWindows).toHaveLength(1);
            await sut.unmute(["test\\"]);
            await sut.loadDynamicMutes();
            expect(sut.muteWindows).toHaveLength(0);
        });
    })
    describe("when the configured timezone differs from the host timezone", () => {
        afterEach(() => {
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
        });

        function getFutureRange() {
            // kept well in the future so the window is not discarded as expired
            const from = new Date();
            from.setUTCDate(from.getUTCDate() + 30);
            from.setUTCHours(10, 0, 0, 0);
            const to = new Date(from);
            to.setUTCHours(12, 0, 0, 0);
            return { from, to };
        }

        describe.each([
            ["UTC", "10:00", "12:00"],
            ["Asia/Tokyo", "19:00", "21:00"]
        ])("in %s", (timezone, expectedStart, expectedEnd) => {
            it("should record the window against the configured timezone, not the host", async () => {
                // arrange
                initLocaleAndTimezone({ locale: "en-ZA", timezone });
                const sut = getSut();
                const { from, to } = getFutureRange();

                // act
                await sut.registerMute("test::123", from, to);
                await sut.loadDynamicMutes();

                // assert
                expect(sut.muteWindows).toHaveLength(1);
                const window = sut.muteWindows[0];
                expect(window.startTime).toEqual(expectedStart);
                expect(window.endTime).toEqual(expectedEnd);
            });
        });
    });
});
