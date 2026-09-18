import { escapeRegex } from "../lib/key.js";

// slack delivers a mention as "<@U05NX4E9VEW>", and older clients as "<@U05NX4E9VEW|barky>"
const UserMentionPattern = "<@([A-Za-z0-9]+)(?:\\|[^>]*)?>";

/*
 The slack ids a message mentions, in the order they were said and without repeats - the same bot
 is often named twice in one line.
 */
export function mentionedUserIds(text: string): string[] {
    const matches = (text ?? "").matchAll(new RegExp(UserMentionPattern, "g"));
    return Array.from(new Set(Array.from(matches, x => x[1])));
}

/*
 What may come before an @ that names someone: the start of the message, whitespace, or the
 punctuation people open a phrase with. Spelt out rather than as "not a word character", which also
 admits the separator in a user group ("<!subteam^S012ABC|@barky-oncall>") and the slash in a url
 ("github.com/@barky/x") - neither of which names barky, and both of which a channel does say.
 */
const MentionLeaderPattern = "(?:^|[\\s(\\[{\"'])";

/*
 An @ that names someone, as opposed to the name merely being said: "@barky 1" is an answer and
 "wonder if barky is broken" is people talking to each other. The character before the @ has to be
 one that can start a word, so "rohland@barky.co.za" names nobody, and anything may follow the name
 itself, so "@barky-spar" names a barky too.
 */
export function namesInText(text: string, name: string): boolean {
    if (!name) {
        return false;
    }
    return new RegExp(`${ MentionLeaderPattern }@[\\w.-]*${ escapeRegex(name) }`, "i").test(text ?? "");
}

/*
 Whether a slack display name is a barky's. Matched loosely and without case, because every barky
 in a channel is a separate slack app and they are named apart on purpose - "Barky", "barky-spar"
 and "Barky (YUMBI)" are all the same bot as far as a reply naming one of them is concerned.
 */
export function isNamed(displayName: string, name: string): boolean {
    if (!name || !displayName) {
        return false;
    }
    return displayName.toLowerCase().includes(name.toLowerCase());
}

// nothing without an @ in it can name anyone, and most of what a channel says has none
export function couldNameAnyone(text: string): boolean {
    return (text ?? "").includes("@");
}
