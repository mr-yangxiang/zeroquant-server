import { Router } from 'express'
import { requireUser } from '../auth/auth.middleware.js'
import { asyncHandler } from '../../shared/http.js'
import type { ChatTradeService } from './chat-trade.service.js'
import { ChatTradeController } from './chat-trade.controller.js'
export function chatTradeRouter(service: ChatTradeService, research?: ResearchChatService, history?: ChatHistoryService) {
  const router = Router()
  router.use(requireUser)
  router.post('/send', asyncHandler(new ChatTradeController(service).send))
  if (research) router.post('/send', asyncHandler(async (req,res) => {
    const data = await research.send(req.principal!.userId,req.body)
    res.setHeader('Cache-Control','no-store')
    res.json({ code:0, data })
  }))
  if (history) {
    router.get('/messages', asyncHandler(async (req,res) => {
      const page = await history.page(req.principal!.userId,req.query)
      res.setHeader('Cache-Control','no-store')
      res.json({ code:0, data:page.messages, nextCursor:page.nextCursor })
    }))
    router.delete('/messages', asyncHandler(async (req,res) => {
      await history.clear(req.principal!.userId,req.query)
      res.json({ code:0, message:'对话记录已清空' })
    }))
  }
  return router
}

import type { ResearchChatService } from './research-chat.service.js'
import type { ChatHistoryService } from './chat-history.service.js'
