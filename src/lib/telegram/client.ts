import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import bigInt from 'big-integer';

interface ParsedMessage {
  id: number;
  text: string;
  date: number;
  fromId?: string;
  replyToMsgId?: number;
  topicId?: number;
}

interface ForumTopicInfo {
  id: number;
  title: string;
  unreadCount: number;
  lastMessageId?: number;
  date: number;
  closed: boolean;
  pinned: boolean;
}

export class TelegramService {
  private client: TelegramClient | null = null;
  private apiId: number;
  private apiHash: string;
  private stringSession: StringSession;

  constructor() {
    this.apiId = parseInt(process.env.TELEGRAM_API_ID!);
    this.apiHash = process.env.TELEGRAM_API_HASH!;
    this.stringSession = new StringSession(
      process.env.TELEGRAM_STRING_SESSION || ''
    );
  }

  async connect() {
    if (this.client && this.client.connected) {
      return this.client;
    }

    this.client = new TelegramClient(
      this.stringSession,
      this.apiId,
      this.apiHash,
      {
        connectionRetries: 5,
      }
    );

    await this.client.connect();
    console.log('Connected to Telegram');
    return this.client;
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  private parseMessage(msg: Api.TypeMessage): ParsedMessage | null {
    if (msg instanceof Api.Message) {
      // Extract topic ID if this is a forum message
      let topicId: number | undefined;
      if (msg.replyTo && 'replyToTopId' in msg.replyTo) {
        topicId = msg.replyTo.replyToTopId;
      } else if (
        msg.replyTo &&
        'forumTopic' in msg.replyTo &&
        msg.replyTo.forumTopic
      ) {
        topicId = msg.replyTo.replyToMsgId;
      }

      return {
        id: msg.id,
        text: msg.message || '',
        date: msg.date,
        fromId: msg.fromId ? this.extractPeerId(msg.fromId) : undefined,
        replyToMsgId:
          msg.replyTo && 'replyToMsgId' in msg.replyTo
            ? msg.replyTo.replyToMsgId
            : undefined,
        topicId: topicId,
      };
    } else if (msg instanceof Api.MessageService) {
      return {
        id: msg.id,
        text: '[Service Message]',
        date: msg.date,
        fromId: msg.fromId ? this.extractPeerId(msg.fromId) : undefined,
      };
    }

    return null;
  }

  private extractPeerId(peer: Api.TypePeer): string {
    if (peer instanceof Api.PeerUser) {
      return peer.userId.toString();
    } else if (peer instanceof Api.PeerChat) {
      return peer.chatId.toString();
    } else if (peer instanceof Api.PeerChannel) {
      return peer.channelId.toString();
    }
    return '';
  }

  // Get messages from a specific forum topic
  async getForumTopicMessages(
    chatId: string | number,
    topicId: number,
    limit: number = 100
  ): Promise<ParsedMessage[]> {
    const client = await this.connect();

    try {
      const chat = await client.getEntity(chatId);

      // For forum topics, use getReplies with the topic ID
      const result = await client.invoke(
        new Api.messages.GetReplies({
          peer: chat,
          msgId: topicId, // Topic ID is used as msgId for forum topics
          offsetId: 0,
          offsetDate: 0,
          addOffset: 0,
          limit: limit,
          maxId: 0,
          minId: 0,
          hash: bigInt(0),
        })
      );

      const messages: ParsedMessage[] = [];

      if ('messages' in result) {
        for (const msg of result.messages) {
          const parsed = this.parseMessage(msg);
          if (parsed) {
            messages.push(parsed);
          }
        }
      }

      return messages;
    } catch (error) {
      console.error('Error fetching forum topic messages:', error);
      throw error;
    }
  }

  // Stream messages from a specific forum topic in real-time
  async streamForumTopicMessages(
    chatId: string | number,
    topicId: number,
    onMessage: (message: ParsedMessage) => void
  ) {
    const client = await this.connect();

    console.log(
      `Setting up stream for forum topic ${topicId} in chat ${chatId}`
    );

    // Set up message handler for new messages
    client.addEventHandler(async (event: NewMessageEvent) => {
      const message = event.message;

      if (!message || !(message instanceof Api.Message)) {
        return;
      }

      // Check if message is from our target chat
      const msgChatId = message.peerId
        ? this.extractPeerId(message.peerId)
        : '';

      if (
        msgChatId === chatId.toString() ||
        msgChatId === chatId.toString().replace('-100', '')
      ) {
        // For forum topics, check if the message belongs to our topic
        // Topic ID 1 (General) usually gets all root messages and replies to topic 1
        if (topicId === Number(process.env.TOPIC_ID)) {
          // General topic - check if it's a root message or reply to topic 1
          if (
            !message.replyTo ||
            (message.replyTo &&
              'replyToTopId' in message.replyTo &&
              message.replyTo.replyToTopId === 1) ||
            (message.replyTo &&
              'forumTopic' in message.replyTo &&
              message.replyTo.forumTopic)
          ) {
            const parsed = this.parseMessage(message);
            if (parsed) {
              console.log(
                `New message in General topic: ${parsed.text.substring(
                  0,
                  50
                )}...`
              );
              onMessage(parsed);
            }
          }
        } else {
          // Other topics - check for specific topic ID
          if (
            message.replyTo &&
            'replyToTopId' in message.replyTo &&
            message.replyTo.replyToTopId === topicId
          ) {
            const parsed = this.parseMessage(message);
            if (parsed) {
              console.log(
                `New message in topic ${topicId}: ${parsed.text.substring(
                  0,
                  50
                )}...`
              );
              onMessage(parsed);
            }
          }
        }
      }
    }, new NewMessage({}));

    console.log('Forum topic streaming started');
  }

  // Get all forum topics with proper type checking
  async getForumTopics(chatId: string | number): Promise<ForumTopicInfo[]> {
    const client = await this.connect();

    try {
      const entity = await client.getEntity(chatId);

      const result = await client.invoke(
        new Api.channels.GetForumTopics({
          channel: entity,
          offsetDate: 0,
          offsetId: 0,
          offsetTopic: 0,
          limit: 100,
        })
      );

      const topics: ForumTopicInfo[] = [];

      if (result.topics) {
        for (const topic of result.topics) {
          // Type guard to check if it's a ForumTopic (not ForumTopicDeleted)
          if (topic instanceof Api.ForumTopic) {
            topics.push({
              id: topic.id,
              title: topic.title,
              unreadCount: topic.unreadCount || 0,
              lastMessageId: topic.topMessage,
              date: topic.date,
              closed: topic.closed || false,
              pinned: topic.pinned || false,
            });
          }
        }
      }

      return topics;
    } catch (error) {
      console.error('Error fetching forum topics:', error);
      throw error;
    }
  }

  // Alternative: Get historical messages from the entire supergroup
  async getSupergroupMessages(
    chatId: string | number,
    limit: number = 100,
    offsetId: number = 0
  ): Promise<ParsedMessage[]> {
    const client = await this.connect();

    try {
      const chat = await client.getEntity(chatId);

      const result = await client.invoke(
        new Api.messages.GetHistory({
          peer: chat,
          offsetId: offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit: limit,
          maxId: 0,
          minId: 0,
          hash: bigInt(0),
        })
      );

      const messages: ParsedMessage[] = [];

      if ('messages' in result) {
        for (const msg of result.messages) {
          const parsed = this.parseMessage(msg);
          if (parsed) {
            messages.push(parsed);
          }
        }
      }

      return messages;
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  }
}
