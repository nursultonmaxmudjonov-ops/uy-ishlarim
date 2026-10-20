// convex/app.js
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// 1. Foydalanuvchini olish yoki yaratish
export const getOrCreateUser = mutation({
  args: { telegramId: v.string(), fullName: v.string(), phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_telegramId", (q) => q.eq("telegramId", args.telegramId))
      .unique();

    if (existing) {
      if (!existing.isRegistered && args.phoneNumber) {
        await ctx.db.patch(existing._id, {
          fullName: args.fullName,
          phoneNumber: args.phoneNumber,
          isRegistered: true,
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      telegramId: args.telegramId,
      fullName: args.fullName,
      phoneNumber: args.phoneNumber,
      isRegistered: !!args.phoneNumber,
    });
  },
});

export const getCurrentUser = query({
  args: { telegramId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_telegramId", (q) => q.eq("telegramId", args.telegramId))
      .unique();
  },
});

// 2. Barcha foydalanuvchilar va ularning kontakt holatini olish
export const getAllUsers = query({
  args: { currentUserId: v.id("users") },
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    const myContacts = await ctx.db
      .query("contacts")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.currentUserId))
      .collect();

    const contactSet = new Set(myContacts.map((c) => c.contactUserId.toString()));

    return users
      .filter((u) => u._id !== args.currentUserId && u.isRegistered)
      .map((u) => ({
        ...u,
        isContact: contactSet.has(u._id.toString()),
      }));
  },
});

// 3. Kontaktga qo'shish
export const addContact = mutation({
  args: { ownerId: v.id("users"), contactUserId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_owner_and_contact", (q) =>
        q.eq("ownerId", args.ownerId).eq("contactUserId", args.contactUserId)
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("contacts", {
        ownerId: args.ownerId,
        contactUserId: args.contactUserId,
      });
    }
  },
});

// 4. O'zaro kontaktlar bir-biriga yozishi uchun tekshirish
export const checkCanChat = query({
  args: { user1Id: v.id("users"), user2Id: v.id("users") },
  handler: async (ctx, args) => {
    const c1 = await ctx.db
      .query("contacts")
      .withIndex("by_owner_and_contact", (q) =>
        q.eq("ownerId", args.user1Id).eq("contactUserId", args.user2Id)
      )
      .unique();

    const c2 = await ctx.db
      .query("contacts")
      .withIndex("by_owner_and_contact", (q) =>
        q.eq("ownerId", args.user2Id).eq("contactUserId", args.user1Id)
      )
      .unique();

    return !!(c1 && c2);
  },
});

// 5. Xabarlarni olish va yuborish
export const getMessages = query({
  args: { user1Id: v.id("users"), user2Id: v.id("users") },
  handler: async (ctx, args) => {
    const msgs1 = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("senderId", args.user1Id).eq("receiverId", args.user2Id)
      )
      .collect();

    const msgs2 = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("senderId", args.user2Id).eq("receiverId", args.user1Id)
      )
      .collect();

    return [...msgs1, ...msgs2].sort((a, b) => a._creationTime - b._creationTime);
  },
});

export const sendMessage = mutation({
  args: {
    senderId: v.id("users"),
    receiverId: v.id("users"),
    type: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      senderId: args.senderId,
      receiverId: args.receiverId,
      type: args.type,
      content: args.content,
      isRead: false,
    });
  },
});

// 6. Xabarlarni o'qildi (Read) holatiga o'tkazish
export const markAsRead = mutation({
  args: { messageIds: v.array(v.id("messages")) },
  handler: async (ctx, args) => {
    for (const id of args.messageIds) {
      await ctx.db.patch(id, { isRead: true });
    }
  },
});

// 7. Qo'ng'iroqlar logikasi
export const startCall = mutation({
  args: { callerId: v.id("users"), receiverId: v.id("users"), type: v.string() },
  handler: async (ctx, args) => {
    const roomName = `room_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return await ctx.db.insert("calls", {
      callerId: args.callerId,
      receiverId: args.receiverId,
      type: args.type,
      status: "calling",
      roomName,
    });
  },
});

export const getIncomingCall = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("calls")
      .withIndex("by_receiver", (q) => q.eq("receiverId", args.userId))
      .filter((q) => q.eq(q.field("status"), "calling"))
      .first();
  },
});

export const updateCallStatus = mutation({
  args: { callId: v.id("calls"), status: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.callId, { status: args.status });
  },
});

// 8. WebRTC Signallar (Videokamera uchun)
export const sendSignal = mutation({
  args: {
    callId: v.id("calls"),
    senderId: v.id("users"),
    type: v.string(),
    data: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("callSignals", {
      callId: args.callId,
      senderId: args.senderId,
      type: args.type,
      data: args.data,
    });
  },
});

export const getSignals = query({
  args: { callId: v.id("calls"), currentUserId: v.id("users") },
  handler: async (ctx, args) => {
    const signals = await ctx.db
      .query("callSignals")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();

    return signals.filter((s) => s.senderId !== args.currentUserId);
  },
});