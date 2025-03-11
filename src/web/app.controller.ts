import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { getAlertState } from "../digest/alerter";
import { uniqueKey } from "../lib/key";

@Controller()
export class AppController {
    @Get()
    getHtml(@Res() res: Response) {
        const htmlFilePath = join(__dirname, './', 'index.html');
        return res.sendFile(htmlFilePath);
    }

    @Post('api/mute')
    muteSnapshot(@Body() _payload: any) {
        return { success: true, message: 'Muted successfully' };
    }

    @Get('api/status')
    getJson() {
        //
        // return {
        //     "summary": {
        //         "startTime": "2025-03-11 09:00"
        //     },
        //     "active": [
        //         {
        //             "id": "123",
        //             "type": "mysql",
        //             "label": "queue-performance",
        //             "identifier": "my-app",
        //             "startTime": "2025-03-11 09:00",
        //             "resolvedTime": null,
        //             "muted": false,
        //             "last_result": "40 suspended messages",
        //             "links": [
        //                 {
        //                     "label": "Sumo",
        //                     "url": "https://www.google.com"
        //                 }
        //             ]
        //         }
        //     ],
        //     "muted": [{
        //         "id": "123",
        //         "type": "sumo",
        //         "label": "queue-performance",
        //         "identifier": "my-app",
        //         "startTime": "2025-03-11 09:00",
        //         "resolvedTime": "2025-03-11 10:00",
        //         "muted": true,
        //         "last_result": "10 suspended messages",
        //         "links": [
        //             {
        //                 "label": "Sumo",
        //                 "url": "https://www.google.com"
        //             }
        //         ]
        //     }],
        //     "resolved": [
        //         {
        //             "id": "123",
        //             "type": "sumo",
        //             "label": "queue-performance",
        //             "identifier": "my-app",
        //             "startTime": "2025-03-11 09:00",
        //             "resolvedTime": "2025-03-11 10:00",
        //             "muted": false,
        //             "last_result": "10 suspended messages",
        //             "links": [
        //                 {
        //                     "label": "Sumo",
        //                     "url": "https://www.google.com"
        //                 }
        //             ]
        //         }
        //     ]
        // };
        const status = getAlertState();
        if (!status.context) {
            return {
                "alert": null,
                "active": [],
                "resolved": [],
                "muted": []
            }
        }
        const alerts = [...status.newAlerts, ...status.existingAlerts];
        const snapshots = status.context.alertableSnapshots(status.config);
        const muteLookup = new Map(snapshots.map(x => [x.uniqueId, x.muted]));
        const active = snapshots.map(x => {
            return {
                id: x.uniqueId,
                type: x.type,
                label: x.label,
                identifier: x.identifier,
                startTime: x.date,
                resolvedTime: null,
                muted: false,
                last_result: x.last_result,
                links: x.alert?.links
            }
        });
        const resolvedOrMuted = alerts.flatMap(x => x.getResolvedOrMutedSnapshotList(snapshots.map(x => x.uniqueId)));
        const resolvedSet = new Set();
        const resolvedSnapshots = resolvedOrMuted.map(x => {
            const snapshot = x.lastSnapshot;
            const id = uniqueKey(x.key);
            if (resolvedSet.has(id)) {
                return null;
            }
            resolvedSet.add(id);
            return {
                id,
                type: x.key.type,
                label: x.key.label,
                identifier: x.key.identifier,
                startTime: snapshot.date,
                resolvedTime: snapshot.resolvedDate,
                last_result: snapshot.result,
                muted: muteLookup.get(id) ?? false,
                links: snapshot.alert?.links
            }
        }).filter(x => x);
        let muted = status.context.digestableSnapshots.filter(x => x.muted).map(x => {
            return {
                id: x.uniqueId,
                type: x.type,
                label: x.label,
                identifier: x.identifier,
                startTime: x.date,
                resolvedTime: null,
                muted: true,
                last_result: x.last_result,
                links: x.alert?.links
            }
        });
        muted = [...muted, ...resolvedSnapshots.filter(x => x.muted)];
        const mutedKeys = new Set(muted.map(x => x.id));
        const resolved = resolvedSnapshots.filter(x => !x.muted && !mutedKeys.has(x.id));
        const all = [...active, ...muted, ...resolved];
        const oldestAlert = active.length > 0 && all.length > 0 ? all.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0] : null;
        return {
            summary: oldestAlert
                ? {
                    startTime: oldestAlert.startTime
                }
                : null,
            active: active,
            muted: muted,
            resolved: resolved
        };
    }
}
