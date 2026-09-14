import { importActualAndMock, importAndMock } from "./import-and-mock.js";

const mocked = await importAndMock("../src/lib/sleep.ts", () => ({
    sleepMs: jest.fn()
}));
const partiallyMocked = await importActualAndMock("../src/lib/period-parser.ts", () => ({
    isPeriod: jest.fn().mockReturnValue(true)
}));

describe("importAndMock", () => {
    describe("the mocks it returns", () => {
        it("should be the very same instances the module under test imports", async () => {
            // arrange - the factory is invoked once per module registry, so without care the
            // caller ends up holding different mocks to the code it is testing, and every
            // assertion silently reports zero calls
            const imported = await import("../src/lib/sleep.js");

            // act
            await imported.sleepMs(1);

            // assert
            expect(imported.sleepMs).toBe(mocked.sleepMs);
            expect(mocked.sleepMs).toHaveBeenCalledWith(1);
        });
        it("should stay the same instance across repeated imports", async () => {
            const first = await import("../src/lib/sleep.js");
            const second = await import("../src/lib/sleep.js");
            expect(first.sleepMs).toBe(second.sleepMs);
        });
    });
});

describe("importActualAndMock", () => {
    it("should replace only what the factory names", async () => {
        const imported = await import("../src/lib/period-parser.js");
        expect(imported.isPeriod).toBe(partiallyMocked.isPeriod);
        expect(imported.isPeriod("nonsense")).toEqual(true);
    });
    it("should keep the rest of the module working", async () => {
        const imported = await import("../src/lib/period-parser.js");
        expect(imported.parsePeriodToMinutes("15m")).toEqual(15);
    });
});
