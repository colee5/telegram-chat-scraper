import { NextRequest, NextResponse } from 'next/server';
import { TelegramService } from '@/lib/telegram/client';

export const dynamic = 'force-dynamic';

let telegramService: TelegramService | null = null;

function getTelegramService() {
  if (!telegramService) {
    telegramService = new TelegramService();
  }
  return telegramService;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const chatId = searchParams.get('chatId') || process.env.SUPERGROUP_ID!;
    const topicId = parseInt(
      searchParams.get('topicId') || process.env.TOPIC_ID || '1'
    );
    const limit = parseInt(searchParams.get('limit') || '100');

    const service = getTelegramService();

    // Get messages from the forum topic (General by default)
    const messages = await service.getForumTopicMessages(
      chatId,
      topicId,
      limit
    );

    return NextResponse.json({
      success: true,
      topicId: topicId,
      count: messages.length,
      messages: messages,
    });
  } catch (error) {
    console.error('Error fetching messages:', error);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch messages',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
