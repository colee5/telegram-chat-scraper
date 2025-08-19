const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
require('dotenv').config({ path: '.env.local' });

async function getForumTopics() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH;
  const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION);

  console.log('Connecting to Telegram...');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log('Connected!');

  // Your supergroup ID from the URL
  // Note: In the API, you need to add -100 prefix for supergroups
  const supergroupId = '-1002731547761'; // Added -100 prefix to your ID

  try {
    console.log(`\nFetching forum topics from supergroup: ${supergroupId}\n`);

    // Get the supergroup entity
    const entity = await client.getEntity(supergroupId);
    console.log(`Supergroup name: ${entity.title}\n`);

    // Get forum topics
    const result = await client.invoke(
      new Api.channels.GetForumTopics({
        channel: entity,
        offsetDate: 0,
        offsetId: 0,
        offsetTopic: 0,
        limit: 100,
      })
    );

    if (!result.topics || result.topics.length === 0) {
      console.log(
        'No forum topics found. This might not be a forum-enabled supergroup.'
      );
      return;
    }

    console.log(`=== FORUM TOPICS (SUBCHANNELS) === \n`);
    console.log(`Found ${result.topics.length} topics:\n`);

    for (const topic of result.topics) {
      console.log(`📌 Topic ID: ${topic.id}`);
      console.log(`   Title: ${topic.title}`);

      if (topic.iconColor) {
        console.log(`   Color: #${topic.iconColor.toString(16)}`);
      }

      if (topic.iconEmojiId) {
        console.log(`   Icon Emoji ID: ${topic.iconEmojiId}`);
      }

      console.log(
        `   Created: ${new Date(topic.date * 1000).toLocaleString()}`
      );

      if (topic.topMessage) {
        console.log(`   Last Message ID: ${topic.topMessage}`);
      }

      if (topic.unreadCount !== undefined) {
        console.log(`   Unread Count: ${topic.unreadCount}`);
      }

      console.log(`   Closed: ${topic.closed ? 'Yes' : 'No'}`);
      console.log(`   Pinned: ${topic.pinned ? 'Yes' : 'No'}`);
      console.log('---');
    }

    // Now let's get messages from a specific topic
    console.log('\n=== FETCHING MESSAGES FROM EACH TOPIC ===\n');

    for (const topic of result.topics) {
      console.log(`\n📌 Messages from "${topic.title}" (ID: ${topic.id}):`);

      try {
        // Get messages from this specific topic/thread
        const messages = await client.invoke(
          new Api.messages.GetReplies({
            peer: entity,
            msgId: topic.id,
            offsetId: 0,
            offsetDate: 0,
            addOffset: 0,
            limit: 5, // Get last 5 messages from each topic
            maxId: 0,
            minId: 0,
            hash: 0n,
          })
        );

        if (messages.messages && messages.messages.length > 0) {
          let msgCount = 0;
          for (const msg of messages.messages) {
            if (msg.className === 'Message' && msgCount < 3) {
              console.log(`   - Message ID: ${msg.id}`);
              console.log(
                `     Text: ${
                  msg.message ? msg.message.substring(0, 50) + '...' : '[Media]'
                }`
              );
              console.log(
                `     Date: ${new Date(msg.date * 1000).toLocaleString()}`
              );
              msgCount++;
            }
          }
        } else {
          console.log('   No messages in this topic yet.');
        }
      } catch (error) {
        console.log(`   Error fetching messages: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.message.includes('CHANNEL_FORUM_MISSING')) {
      console.log('This supergroup does not have forum topics enabled.');
      console.log('It might be a regular supergroup without subchannels.');
    } else {
      console.error('Error:', error.message);
    }
  } finally {
    await client.disconnect();
  }
}

getForumTopics().catch(console.error);
