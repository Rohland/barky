import { Muter } from "./muter";
import { deleteDbIfExists, destroy, initConnection } from "./models/db";

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
});
