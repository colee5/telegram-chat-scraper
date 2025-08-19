import { NextRequest } from 'next/server';
import { TelegramService } from '@/lib/telegram/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max for Vercel

let telegramService: TelegramService | null = null;

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  // Create new service instance for each connection to avoid stale connections
  telegramService = new TelegramService();

  const searchParams = request.nextUrl.searchParams;
  const chatId = searchParams.get('chatId') || process.env.SUPERGROUP_ID!;
  const topicId = parseInt(
    searchParams.get('topicId') || process.env.TOPIC_ID || '1'
  );

  let heartbeatInterval: NodeJS.Timeout | null = null;
  let isStreamActive = true;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial connection message
        const connectMsg = `data: ${JSON.stringify({
          type: 'connected',
          topicId: topicId,
          chatId: chatId,
          timestamp: Date.now(),
        })}\n\n`;
        controller.enqueue(encoder.encode(connectMsg));

        // Set up message streaming
        await telegramService!.streamForumTopicMessages(
          chatId,
          topicId,
          (message) => {
            if (!isStreamActive) return;

            try {
              const data = `data: ${JSON.stringify({
                type: 'message',
                topicId: topicId,
                ...message,
                timestamp: Date.now(),
              })}\n\n`;
              controller.enqueue(encoder.encode(data));
            } catch (error) {
              console.error('Error encoding message:', error);
            }
          }
        );

        // More frequent heartbeat to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (!isStreamActive) {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          }

          try {
            const ping = `data: ${JSON.stringify({
              type: 'ping',
              timestamp: Date.now(),
            })}\n\n`;
            controller.enqueue(encoder.encode(ping));
          } catch (error) {
            console.error('Heartbeat error:', error);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            isStreamActive = false;
          }
        }, 5000); // Ping every 5 seconds
      } catch (error) {
        console.error('Stream setup error:', error);
        const errorMsg = `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        })}\n\n`;
        controller.enqueue(encoder.encode(errorMsg));
        controller.close();
      }
    },

    cancel() {
      console.log('Stream cancelled by client');
      isStreamActive = false;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      // Disconnect Telegram client when stream is cancelled
      if (telegramService) {
        telegramService.disconnect().catch(console.error);
      }
    },
  });

  // Clean up on request abort
  request.signal.addEventListener('abort', () => {
    console.log('Request aborted');
    isStreamActive = false;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    if (telegramService) {
      telegramService.disconnect().catch(console.error);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  });
}
