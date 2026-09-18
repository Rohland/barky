import { Result } from "./result.js";
import knex, { Knex } from "knex";
import { Snapshot } from "./snapshot.js";
import { MonitorLog } from "./log.js";
import fs from "fs";
import { AlertState } from "./alerts.js";
import path from "path";
import { IMuteWindowDb } from "./mute-window.js";
import { log } from "./logger.js";

let _connection;
let _context;

export async function initConnection(name: string) {
    if (_connection) {
        return;
    }
    _connection = getConnection(name);
    await intialiseSchema(_connection);
}

export async function destroy() {
    try {
        await _connection?.destroy();
    } catch {
        // no-op
    } finally {
        _context = null;
        _connection = null;
    }
}

export function deleteDbIfExists(file: string) {
    const path = `./db/${ file }.sqlite`;
    if (fs.existsSync(path)) {
        fs.unlinkSync(path);
    }
}

export async function persistResults(results: Result[]) {
    if (!results || results.length === 0) {
        return;
    }
    await logResults(results);
}

export async function persistSnapshots(snapshots: Snapshot[]) {
    return await saveSnapshots(_connection, snapshots);
}

async function saveSnapshots(conn: Knex, snapshots: Snapshot[]) {
    if (!snapshots || snapshots.length === 0) {
        return;
    }
    await conn("snapshots")
        .insert(
            snapshots
                .map(snapshot => {
                    return {
                        date: snapshot.date.toISOString(),
                        type: snapshot.type,
                        label: snapshot.label,
                        identifier: snapshot.identifier,
                        success: snapshot.success,
                        last_result: snapshot.last_result,
                        alert_config: JSON.stringify(snapshot.alert, ignorePrivateFieldsWhenSerialising)
                    };
                }));
}

export async function persistAlerts(alerts: AlertState[]) {
    const persistable = alerts.filter(x => x.size > 0 && !x.isMuted);
    await _connection.transaction(async trx => {
        await trx("alerts").truncate();
        if (persistable.length === 0) {
            return;
        }
        await trx("alerts").insert(persistable.map(x => {
            return {
                channel: x.channel,
                start_date: x.start_date.toISOString(),
                last_alert_date: x.last_alert_date?.toISOString() ?? null,
                affected: JSON.stringify(Array.from(x.affected?.entries() ?? []), ignorePrivateFieldsWhenSerialising),
                state: JSON.stringify(x.state)
            }
        }));
    });
}

export async function mutateAndPersistSnapshotState(
    snapshots: Snapshot[],
    logIdsToDelete: number[]) {
    await _connection.transaction(async trx => {
        if (logIdsToDelete?.length > 0) {
            await trx("logs").whereIn("id", logIdsToDelete).del();
        }
        await trx("snapshots").truncate();
        await saveSnapshots(trx, snapshots);
    });
}

export async function getAlerts(): Promise<AlertState[]> {
    const results = await _connection("alerts").select();
    return results.map(x => new AlertState(x));
}

export async function getSnapshots(): Promise<Snapshot[]> {
    const results = await _connection("snapshots").select();
    return results.map(x => {
        x.alert_config = JSON.parse(x.alert_config);
        return new Snapshot(x);
    });
}

export async function getLogs(): Promise<MonitorLog[]> {
    const results = await _connection("logs").select().orderBy("id", "asc");
    return results.map(x => new MonitorLog(x));
}

const ChatEventRetentionMs = 24 * 60 * 60 * 1000;

/*
 Slack redelivers events when an ack is missed, including across a restart, so every event is
 recorded before it is acted on. Returns false when the event has already been handled.
 */
export async function tryRecordChatEvent(id: string): Promise<boolean> {
    try {
        return await recordFirstDelivery(id);
    } catch (err) {
        return shouldHandleDespite(err, id);
    }
}

async function recordFirstDelivery(id: string): Promise<boolean> {
    await _connection("chat_events").insert({
        id,
        date: new Date().toISOString()
    });
    await pruneChatEvents();
    return true;
}

async function pruneChatEvents(): Promise<void> {
    try {
        await _connection("chat_events")
            .where("date", "<", new Date(Date.now() - ChatEventRetentionMs).toISOString())
            .del();
    } catch {
        // housekeeping only - the event is already recorded, and the next pass prunes what this
        // one missed
    }
}

function shouldHandleDespite(err: any, id: string): boolean {
    if (isDuplicateKeyError(err)) {
        return false;
    }
    // slack has already been acked by this point and will not redeliver, so a message dropped
    // here is dropped for good - better to risk handling it twice than not at all
    log(`error recording chat event '${ id }', handling it anyway: ${ err }`, err);
    return true;
}

function isDuplicateKeyError(err: any): boolean {
    return /SQLITE_CONSTRAINT/i.test(err?.code ?? "")
        || /UNIQUE constraint failed|PRIMARY KEY/i.test(err?.message ?? "");
}

const ChatThreadRetentionMs = 7 * 24 * 60 * 60 * 1000;
const ChatOpsAuditRetentionMs = 30 * 24 * 60 * 60 * 1000;

export interface IChatThread {
    channel: string;
    threadTs: string;
    alertIds: string[];
    // the digest channel config that posted the message, so a reply to it is answered by the same
    // one - null for threads recorded before barky tracked this
    channelName?: string;
    /*
     Set on the follow-up ping barky posts while an alert is ongoing, and names the alert's own
     thread. That message is deleted and reposted every time barky checks, so anything said in its
     thread goes with it - a reply there is answered by pointing at the thread that lasts.
     */
    pointsToTs?: string;
    // a deep link to that thread, where the channel configures a workspace to build one from
    pointsToUrl?: string;
}

export interface IChatOpsAuditEntry {
    id?: number;
    date?: Date;
    channel: string;
    userId: string;
    userName?: string;
    action: string;
    detail: any;
}

/*
 Records which alerts a slack message was reporting, so that a reply in its thread can be resolved
 back to them.
 */
export async function recordChatThread(thread: IChatThread): Promise<void> {
    try {
        await writeChatThread(thread);
    } catch {
        // alerting must not fail because chat ops could not take a note - without the note a reply
        // in the thread falls back to acting on everything currently active
    }
}

async function writeChatThread(thread: IChatThread): Promise<void> {
    await _connection("chat_threads")
        .insert({
            channel: thread.channel,
            thread_ts: thread.threadTs,
            alert_ids: JSON.stringify(thread.alertIds ?? []),
            channel_name: thread.channelName ?? null,
            points_to_ts: thread.pointsToTs ?? null,
            points_to_url: thread.pointsToUrl ?? null,
            date: new Date().toISOString()
        })
        .onConflict(["channel", "thread_ts"])
        .merge(["alert_ids", "channel_name", "points_to_ts", "points_to_url", "date"]);
    await _connection("chat_threads")
        .where("date", "<", new Date(Date.now() - ChatThreadRetentionMs).toISOString())
        .del();
}

export async function getChatThread(
    channel: string,
    threadTs: string): Promise<IChatThread> {
    const result = await _connection("chat_threads")
        .where({ channel, thread_ts: threadTs })
        .first();
    return result ? toChatThread(result) : null;
}

function toChatThread(result: any): IChatThread {
    return {
        channel: result.channel,
        threadTs: result.thread_ts,
        alertIds: JSON.parse(result.alert_ids ?? "[]"),
        channelName: result.channel_name ?? null,
        pointsToTs: result.points_to_ts ?? null,
        pointsToUrl: result.points_to_url ?? null
    };
}

export async function recordChatOpsAudit(entry: IChatOpsAuditEntry): Promise<void> {
    try {
        await writeChatOpsAudit(entry);
    } catch {
        // the mute itself has already been applied - failing here would tell the user nothing
        // happened when it did
    }
}

async function writeChatOpsAudit(entry: IChatOpsAuditEntry): Promise<void> {
    await _connection("chat_ops_audit").insert({
        date: new Date().toISOString(),
        channel: entry.channel,
        user_id: entry.userId,
        action: entry.action,
        detail: JSON.stringify({ ...(entry.detail ?? {}), userName: entry.userName ?? null })
    });
    await _connection("chat_ops_audit")
        .where("date", "<", new Date(Date.now() - ChatOpsAuditRetentionMs).toISOString())
        .del();
}

export async function getChatOpsAudit(limit: number = 100): Promise<IChatOpsAuditEntry[]> {
    // filtered here as well as on write - without chat ops activity nothing would ever prune, and
    // the dashboard would show entries older than the retention it promises
    const results = await _connection("chat_ops_audit")
        .select()
        .where("date", ">=", new Date(Date.now() - ChatOpsAuditRetentionMs).toISOString())
        .orderBy("id", "desc")
        .limit(limit);
    return results.map(x => {
        const detail = JSON.parse(x.detail ?? "{}");
        return {
            id: x.id,
            date: new Date(x.date),
            channel: x.channel,
            userId: x.user_id,
            userName: detail.userName ?? null,
            action: x.action,
            detail
        };
    });
}

export async function addMuteWindow(window: IMuteWindowDb) {
    await addMuteWindows([window]);
}

/*
 Written in one statement so a set of mutes either all take effect or none do - a partial failure
 would leave alerts silenced while the user is told nothing changed.
 */
export async function addMuteWindows(windows: IMuteWindowDb[]) {
    if ((windows ?? []).length === 0) {
        return;
    }
    await _connection("mute_windows").insert(windows.map(window => ({
        match: window.match,
        from: window.from?.toISOString(),
        to: window.to?.toISOString()
    })));
}

export async function deleteMuteWindowsByIds(ids: number[]) {
    if (ids.length === 0) {
        return;
    }
    await _connection("mute_windows").whereIn("id", ids).del();
}

export async function getMuteWindows(): Promise<IMuteWindowDb[]> {
    const results = await _connection("mute_windows").select().orderBy("id", "asc");
    const toReturn = [];
    const toDelete = [];
    results.forEach(x => {
        const window = {
            ...x,
            from: x.from ? new Date(x.from): null,
            to: x.to? new Date(x.to): null,
        };
        if (window.to < new Date()) {
            toDelete.push(window.id);
            return;
        }
        toReturn.push(window);
    });
    if (toDelete.length > 0) {
        await _connection("mute_windows").whereIn("id", toDelete).del();
    }
    return toReturn;
}

async function intialiseSchema(connection: Knex) {
    await createLogsTable(connection);
    await createSnapshotsTable(connection);
    await createAlertsTable(connection);
    await createMuteWindowTable(connection);
    await createChatEventsTable(connection);
    await createChatThreadsTable(connection);
    await createChatOpsAuditTable(connection);
}

async function createChatThreadsTable(connection: Knex) {
    if (await connection.schema.hasTable("chat_threads")) {
        await addChannelNameToChatThreads(connection);
        await addPointerToChatThreads(connection);
        return;
    }
    await connection.schema.createTable(
        "chat_threads",
        table => {
            table.string("channel");
            table.string("thread_ts");
            table.json("alert_ids");
            table.string("channel_name");
            table.string("points_to_ts");
            table.string("points_to_url");
            table.dateTime("date");
            table.primary(["channel", "thread_ts"]);
        }
    );
}

/*
 Added once barky answered a mention in the thread of a follow-up ping rather than ignoring it.
 Existing rows keep a null, which reads as what they are - threads of an alert message itself.
 */
async function addPointerToChatThreads(connection: Knex) {
    if (await connection.schema.hasColumn("chat_threads", "points_to_ts")) {
        return;
    }
    await connection.schema.alterTable(
        "chat_threads",
        table => {
            table.string("points_to_ts");
            table.string("points_to_url");
        });
}

/*
 Added once chat ops could cover more than one channel. Existing rows keep a null, which routes a
 reply to the channel that declared chat ops - the only one that could have posted it before.
 */
async function addChannelNameToChatThreads(connection: Knex) {
    if (await connection.schema.hasColumn("chat_threads", "channel_name")) {
        return;
    }
    await connection.schema.alterTable(
        "chat_threads",
        table => table.string("channel_name"));
}

async function createChatOpsAuditTable(connection: Knex) {
    if (await connection.schema.hasTable("chat_ops_audit")) {
        return;
    }
    await connection.schema.createTable(
        "chat_ops_audit",
        table => {
            table.increments("id").primary();
            table.dateTime("date");
            table.string("channel");
            table.string("user_id");
            table.string("action");
            table.json("detail");
        }
    );
}

async function createChatEventsTable(connection: Knex) {
    if (await connection.schema.hasTable("chat_events")) {
        return;
    }
    await connection.schema.createTable(
        "chat_events",
        table => {
            table.string("id").primary();
            table.dateTime("date");
        }
    );
}

async function createMuteWindowTable(connection: Knex) {
    if (await connection.schema.hasTable("mute_windows")) {
        return;
    }
    await connection.schema.createTable(
        "mute_windows",
        table => {
            table.increments("id").primary();
            table.string("match");
            table.dateTime("from").nullable();
            table.dateTime("to").nullable();
        }
    );
}

async function createAlertsTable(connection: Knex) {
    if (await connection.schema.hasTable("alerts")) {
        return;
    }
    await connection.schema.createTable(
        "alerts",
        table => {
            table.string("channel").primary();
            table.date("start_date");
            table.date("last_alert_date");
            table.json("affected");
            table.json("state");
        }
    );
}

async function createSnapshotsTable(connection: Knex<any, any[]>) {
    if (await connection.schema.hasTable("snapshots")) {
        return;
    }
    await connection.schema.createTable(
        "snapshots",
        table => {
            table.increments("id").primary();
            table.string("type");
            table.string("label");
            table.string("identifier");
            table.string("last_result");
            table.boolean("success");
            table.date("date");
            table.json("alert_config");
            table.unique(["type", "label", "identifier"]);
        }
    );
}

async function createLogsTable(connection: Knex<any, any[]>) {
    if (await connection.schema.hasTable("logs")) {
        return;
    }
    await connection.schema.createTable(
        "logs",
        table => {
            table.increments("id").primary();
            table.date("date");
            table.string("type");
            table.string("label");
            table.string("identifier");
            table.boolean("success");
            table.string("result_msg");
        }
    );
}

async function logResults(results: Result[]) {
    const dataToInsert = results
        .filter(x => !x.success);
    if (dataToInsert.length === 0) {
        return;
    }
    await _connection("logs")
        .insert(
            dataToInsert
                .map(result => {
                    return {
                        date: result.date.toISOString(),
                        type: result.type,
                        label: result.label,
                        identifier: result.identifier,
                        success: result.success,
                        result_msg: result.resultMsg
                    };
                }));
}

export function getConnection(context: string): Knex {
    if (_connection) {
        if (context !== _context) {
            throw new Error(`Sqlite connection already established with context ${ _context } and now requesting ${ context }`);
        }
        return _connection;
    }
    if (!context) {
        throw new Error("Sqlite connection not initialised");
    }
    const dir = `./db`;
    const fullPathToDir = path.resolve(process.env.PWD, dir);
    const relativePath =  `./db/${ context }.sqlite`;
    const fullPath = path.resolve(process.env.PWD, relativePath);
    if (!fs.existsSync(fullPathToDir)){
        fs.mkdirSync(fullPathToDir);
    }
    _context = context;
    _connection = knex({
        client: 'better-sqlite3',
        connection: {
            filename: fullPath
        },
        useNullAsDefault: true
    });
    return _connection;
}

function ignorePrivateFieldsWhenSerialising(key, value) {
    if (key.startsWith("_")) {
        return undefined;
    }
    return value;
}
