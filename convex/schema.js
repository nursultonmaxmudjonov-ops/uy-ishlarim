// convex/schema.js
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    telegramId: v.string(),
    fullName: v.string(),
    phoneNumber: v.string(),
    isRegistered: v.boolean(),
  })
    .index("by_telegramId", ["telegramId"])
    .index("by_phone", ["phoneNumber"]),

  contacts: defineTable({
    ownerId: v.id("users"),
    contactUserId: v.id("users"),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_and_contact", ["ownerId", "contactUserId"]),

  messages: defineTable({
    senderId: v.id("users"),
    receiverId: v.id("users"),
    type: v.string(),
    content: v.string(),
    isRead: v.boolean(),
  }).index("by_conversation", ["senderId", "receiverId"]),

  calls: defineTable({
    callerId: v.id("users"),
    receiverId: v.id("users"),
    type: v.string(),
    status: v.string(),
    roomName: v.string(),
  })
    .index("by_receiver", ["receiverId"])
    .index("by_caller", ["callerId"]),

  // Новая таблица для WebRTC сигналов
  callSignals: defineTable({
    callId: v.id("calls"),
    senderId: v.id("users"),
    type: v.string(), // "offer", "answer", "ice"
    data: v.string(), // JSON string
  }).index("by_call", ["callId"]),
});