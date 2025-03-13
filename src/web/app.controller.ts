import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import path, { join } from 'path';
import { WebState } from "./web.state";
import { Muter } from "../muter";

@Controller()
export class AppController {
    @Get()
    getHtml(@Res() res: Response) {
        const htmlFilePath = path.resolve(join(__dirname, '/views/index.html'));
        return res.sendFile(htmlFilePath);
    }

    @Post('api/mute')
    async muteSnapshot(@Body() payload: any) {
        const { match, from, to } = payload;
        await Muter.getInstance().registerMute(match, new Date(from), new Date(to));
        return { success: true, message: 'Muted successfully', payload };
    }

    @Post('api/unmute')
    async unMuteSnapshot(@Body() payload: any) {
        const { matches } = payload;
        const muter = Muter.getInstance();
        await muter.unmute(matches);
        return { success: true, message: 'Unmuted successfully', payload };
    }

    @Get('api/status')
    async getJson() {
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
        const webState = new WebState();
        return webState.fetch();
    }
}
