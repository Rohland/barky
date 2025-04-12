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
        await Muter.getInstance().registerMute(
            match,
            new Date(from),
            new Date(to));
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
        const webState = new WebState();
        return webState.fetch();
    }
}
