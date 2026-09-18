import { CallBudget } from "./budget.js";

describe("CallBudget", () => {
    describe("within the limit", () => {
        it("should allow the calls", async () => {
            const sut = new CallBudget(3);
            expect(sut.tryConsume()).toEqual(true);
            expect(sut.tryConsume()).toEqual(true);
            expect(sut.tryConsume()).toEqual(true);
            expect(sut.used).toEqual(3);
        });
    });
    describe("once the limit is reached", () => {
        it("should reject rather than queue, so nobody waits on a reply", async () => {
            const sut = new CallBudget(2);
            sut.tryConsume();
            sut.tryConsume();
            expect(sut.tryConsume()).toEqual(false);
        });
    });
    describe("as calls age out of the hour", () => {
        it("should allow more", async () => {
            // arrange
            const sut = new CallBudget(2);
            const start = Date.now();
            sut.tryConsume(start);
            sut.tryConsume(start + 1000);
            expect(sut.tryConsume(start + 2000)).toEqual(false);

            // act - just over an hour after the first two
            const later = start + (60 * 60 * 1000) + 2000;

            // assert
            expect(sut.tryConsume(later)).toEqual(true);
            expect(sut.used).toEqual(1);
        });
    });
});
