import { SelectionStore } from "./selection.js";

describe("SelectionStore", () => {

    const candidates = [
        { id: "web::health::a.com", title: "web::health::a.com" },
        { id: "mysql::lag::db-01", title: "mysql::lag::db-01" }
    ];

    function pinInto(store: SelectionStore, userId = "U1") {
        return store.pin({ kind: "mute", channel: "C1", threadTs: "1.1", userId, candidates });
    }

    describe("pin and get", () => {
        it("should return what was pinned", async () => {
            const sut = new SelectionStore(60_000);
            pinInto(sut);
            expect(sut.get("C1", "1.1", "U1").candidates).toHaveLength(2);
        });
        it("should keep each user's list apart", async () => {
            // arrange - two people running a selection in the same thread
            const sut = new SelectionStore(60_000);
            pinInto(sut, "U1");

            // act & assert
            expect(sut.get("C1", "1.1", "U2")).toBeNull();
            expect(sut.get("C1", "1.1", "U1")).not.toBeNull();
        });
        it("should keep threads apart", async () => {
            const sut = new SelectionStore(60_000);
            pinInto(sut);
            expect(sut.get("C1", "9.9", "U1")).toBeNull();
            expect(sut.get("C2", "1.1", "U1")).toBeNull();
        });
        it("should replace an earlier list for the same conversation", async () => {
            const sut = new SelectionStore(60_000);
            pinInto(sut);
            sut.pin({ kind: "unmute", channel: "C1", threadTs: "1.1", userId: "U1", candidates: [candidates[0]] });
            const result = sut.get("C1", "1.1", "U1");
            expect(result.kind).toEqual("unmute");
            expect(result.candidates).toHaveLength(1);
            expect(sut.size).toEqual(1);
        });
        it("should carry a period requested when the list was raised", async () => {
            const sut = new SelectionStore(60_000);
            sut.pin({ kind: "mute", channel: "C1", threadTs: "1.1", userId: "U1", candidates, durationMs: 3600000 });
            expect(sut.get("C1", "1.1", "U1").durationMs).toEqual(3600000);
        });
        it("should default to being a list of everything, not a scoped one", async () => {
            const sut = new SelectionStore(60_000);
            expect(pinInto(sut).scoped).toEqual(false);
            expect(sut.pin({ kind: "mute", channel: "C1", threadTs: "2.2", userId: "U1", candidates, scoped: true }).scoped).toEqual(true);
        });
    });

    describe("once the ttl has passed", () => {
        it("should no longer be returned by get", async () => {
            const sut = new SelectionStore(0);
            pinInto(sut);
            expect(sut.get("C1", "1.1", "U1")).toBeNull();
        });
        it("should still be visible to peek, so a late reply can be answered", async () => {
            // arrange
            const sut = new SelectionStore(0);
            pinInto(sut);

            // act
            const result = sut.peek("C1", "1.1", "U1");

            // assert
            expect(result.expired).toEqual(true);
            expect(result.selection.kind).toEqual("mute");
        });
    });

    describe("peek", () => {
        describe("for a conversation with no list", () => {
            it("should return nothing", async () => {
                expect(new SelectionStore(60_000).peek("C1", "1.1", "U1")).toBeNull();
            });
        });
        describe("while the list is live", () => {
            it("should say it has not expired", async () => {
                const sut = new SelectionStore(60_000);
                pinInto(sut);
                expect(sut.peek("C1", "1.1", "U1").expired).toEqual(false);
            });
        });
    });

    describe("clear", () => {
        it("should forget the list", async () => {
            const sut = new SelectionStore(60_000);
            pinInto(sut);
            sut.clear("C1", "1.1", "U1");
            expect(sut.peek("C1", "1.1", "U1")).toBeNull();
            expect(sut.size).toEqual(0);
        });
    });

    describe("sweep", () => {
        it("should keep expired lists through the grace period", async () => {
            // arrange - expired immediately, but the grace period has not elapsed
            const sut = new SelectionStore(0, 60_000);
            pinInto(sut);

            // act
            sut.sweep();

            // assert
            expect(sut.size).toEqual(1);
            expect(sut.peek("C1", "1.1", "U1").expired).toEqual(true);
        });
        it("should drop lists once the grace period has passed", async () => {
            const sut = new SelectionStore(0, 0);
            pinInto(sut, "U1");
            pinInto(sut, "U2");
            sut.sweep();
            expect(sut.size).toEqual(0);
        });
        it("should leave live lists alone", async () => {
            const sut = new SelectionStore(60_000, 0);
            pinInto(sut);
            sut.sweep();
            expect(sut.size).toEqual(1);
        });
    });
});
