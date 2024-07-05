import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import userModel from "./src/models/User.js";
import eventModel from "./src/models/Event.js";
import connectDb from "./src/config/db.js";
import OpenAI from "openai";

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

try {
  connectDb();
  console.log("Database connected successfully");
} catch (error) {
  console.error("Error connecting to database:", error);
  process.kill(process.pid, "SIGTERM");
}

bot.start(async (ctx) => {
  const from = ctx.update.message.from;

  try {
    await userModel.findOneAndUpdate(
      { tgId: from.id },
      {
        $setOnInsert: {
          firstName: from.first_name,
          lastName: from.last_name,
          isBot: from.is_bot,
          username: from.username,
        },
      },
      { upsert: true, new: true }
    );

    await ctx.reply(
      `Hey ${from.first_name}, welcome aboard! 🌟 I'm here to craft highly engaging social media posts for you. Just keep me updated with your day's events. 📅 Let's make waves on social media together! 🌊`
    );
  } catch (error) {
    console.error("Error processing user:", error);
    await ctx.reply("Facing difficulties! Please try again later.");
  }

  await ctx.reply("Welcome to PostMaster Bot, it's working!");
});

bot.help((ctx) => {
  ctx.reply('For support contact @postmasterhelp')
});

bot.command("generate", async (ctx) => {
  const from = ctx.update.message.from;

  // Send a GIF to indicate that the bot is working on generating posts
  const gifUrl = "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExcWNqa2hjZzZtenhlbG13cGYzemQ2YnR6dmI4MWh1NzlmcTZ6dGYxYSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/13GIgrGdslD9oQ/giphy.gif"; // Replace with your GIF URL
  const { message_id: waitingMessageId } = await ctx.sendAnimation(gifUrl, {
    caption: `Hey! ${from.first_name}, kindly wait a moment. I am curating posts for you.`,
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const events = await eventModel.find({
      tgId: from.id,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    if (events.length === 0) {
      await ctx.deleteMessage(waitingMessageId);
      await ctx.reply("No events for the day.");
      return;
    }

    const eventsText = events.map((event) => event.text).join(", ");

    const chatCompletion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "Act as a senior copywriter, you write highly engaging posts for LinkedIn, Instagram, and Twitter using provided thoughts/events throughout the day.",
        },
        {
          role: "user",
          content: `Write like a human, for humans. Craft three engaging social media posts tailored for LinkedIn, Instagram, and Twitter audience. Use the provided events without mentioning specific times. Focus on engaging the respective platform's audience, encouraging interaction, and driving interest in the events: ${eventsText}`,
        },
      ],
      model: process.env.OPENAI_MODEL,
    });

    console.log("OpenAI completions:", chatCompletion);

    // Store token count and other relevant data

    await userModel.findOneAndUpdate(
      {
        tgId: from.id,
      },
      {
        $inc: {
          promptTokens: chatCompletion.usage.prompt_tokens,
          completionTokens: chatCompletion.usage.completion_tokens,
        },
      }
    );

    await ctx.deleteMessage(waitingMessageId);

    await ctx.reply(chatCompletion.choices[0].message.content);

    // Send generated posts or additional messages
  } catch (error) {
    if (error.code === "insufficient_quota") {
      console.log("Reached OpenAI API quota. Retrying after some time...");
      await ctx.reply("Reached API quota. Please try again later.");
    } else {
      console.error("Error generating posts:", error);
      await ctx.reply("Facing difficulties! Please try again later.");
    }
  }
});

bot.on(message("text"), async (ctx) => {
  try {
    const from = ctx.update.message.from;
    const messageText = ctx.update.message.text;

    await eventModel.create({
      text: messageText,
      tgId: from.id,
    });

    await ctx.reply(
      "Noted! 📝 Feel free to share your thoughts with me. When you're ready to generate a post, simply enter: /generate 🚀"
    );
  } catch (error) {
    console.error("Error storing event:", error);
    await ctx.reply("Failed to process your message.");
  }
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
