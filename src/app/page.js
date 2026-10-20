// src/app/page.js
"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function TelegramChatApp() {
  const [tgUser, setTgUser] = useState(null);
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [showStickers, setShowStickers] = useState(false);

  // Call State
  const [activeCall, setActiveCall] = useState(null);
  const [callType, setCallType] = useState(null);

  // WebRTC Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.Telegram?.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();
        setTgUser(tg.initDataUnsafe.user);
      } else {
        let savedId = sessionStorage.getItem("test_tg_id");
        let savedName = sessionStorage.getItem("test_tg_name");

        if (!savedId) {
          savedId = String(Math.floor(100000 + Math.random() * 900000));
          savedName = `User_${savedId.slice(-3)}`;
          sessionStorage.setItem("test_tg_id", savedId);
          sessionStorage.setItem("test_tg_name", savedName);
        }

        setTgUser({ id: savedId, first_name: savedName });
      }
    }
  }, []);

  const telegramId = tgUser?.id ? String(tgUser.id) : "";

  const currentUser = useQuery(
    api.app.getCurrentUser,
    telegramId ? { telegramId } : "skip"
  );
  const getOrCreateUser = useMutation(api.app.getOrCreateUser);
  const allUsers = useQuery(
    api.app.getAllUsers,
    currentUser?._id ? { currentUserId: currentUser._id } : "skip"
  );
  const addContact = useMutation(api.app.addContact);

  const canChat = useQuery(
    api.app.checkCanChat,
    currentUser?._id && selectedUser?._id
      ? { user1Id: currentUser._id, user2Id: selectedUser._id }
      : "skip"
  );

  const messages = useQuery(
    api.app.getMessages,
    currentUser?._id && selectedUser?._id
      ? { user1Id: currentUser._id, user2Id: selectedUser._id }
      : "skip"
  );

  const sendMessage = useMutation(api.app.sendMessage);
  const startCallMutation = useMutation(api.app.startCall);
  const updateCallStatus = useMutation(api.app.updateCallStatus);
  const markAsRead = useMutation(api.app.markAsRead);
  const sendSignal = useMutation(api.app.sendSignal);

  const incomingCall = useQuery(
    api.app.getIncomingCall,
    currentUser?._id ? { userId: currentUser._id } : "skip"
  );

  const signals = useQuery(
    api.app.getSignals,
    activeCall?._id && currentUser?._id
      ? { callId: activeCall._id, currentUserId: currentUser._id }
      : "skip"
  );

  useEffect(() => {
    if (messages && currentUser) {
      const unreadIds = messages
        .filter((m) => m.receiverId === currentUser._id && !m.isRead)
        .map((m) => m._id);

      if (unreadIds.length > 0) {
        markAsRead({ messageIds: unreadIds });
      }
    }
  }, [messages, currentUser, markAsRead]);

  // WebRTC sozlamasi va rol taqsimoti (isCaller)
  const setupMediaAndPeer = async (isVideo, isCaller, callObj) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true,
      });
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && callObj) {
          sendSignal({
            callId: callObj._id,
            senderId: currentUser._id,
            type: "ice",
            data: JSON.stringify(event.candidate),
          });
        }
      };

      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({
          callId: callObj._id,
          senderId: currentUser._id,
          type: "offer",
          data: JSON.stringify(offer),
        });
      }

      return pc;
    } catch (err) {
      console.warn("Kamera band yoki xatolik:", err);
      alert("Kamera/Mikrofonga ulanishda xatolik yuz berdi!");
    }
  };

  useEffect(() => {
    if (!signals || !peerConnectionRef.current || !activeCall) return;

    signals.forEach(async (signal) => {
      const pc = peerConnectionRef.current;
      const data = JSON.parse(signal.data);

      if (signal.type === "offer" && pc.signalingState === "stable") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal({
          callId: activeCall._id,
          senderId: currentUser._id,
          type: "answer",
          data: JSON.stringify(answer),
        });
      } else if (signal.type === "answer" && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
      } else if (signal.type === "ice") {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data));
        } catch (e) {
          console.error("ICE error", e);
        }
      }
    });
  }, [signals, activeCall, currentUser, sendSignal]);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!telegramId || !fullName || !phoneNumber) return;
    await getOrCreateUser({ telegramId, fullName, phoneNumber });
  };

  const handleSend = async (type = "text", content = messageText) => {
    if (!content || !canChat) return;
    await sendMessage({
      senderId: currentUser._id,
      receiverId: selectedUser._id,
      type,
      content,
    });
    setMessageText("");
    setShowStickers(false);
  };

  const handleStartCall = async (type) => {
    if (!selectedUser) return;
    const callId = await startCallMutation({
      callerId: currentUser._id,
      receiverId: selectedUser._id,
      type,
    });

    const callObj = { _id: callId, type };
    setActiveCall(callObj);
    setCallType(type);

    await setupMediaAndPeer(type === "video", true, callObj);
  };

  const handleAcceptCall = async () => {
    if (incomingCall) {
      await updateCallStatus({ callId: incomingCall._id, status: "accepted" });
      setActiveCall(incomingCall);
      setCallType(incomingCall.type);

      await setupMediaAndPeer(incomingCall.type === "video", false, incomingCall);
    }
  };

  const handleEndCall = async () => {
    if (activeCall) {
      await updateCallStatus({ callId: activeCall._id, status: "ended" });
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    setActiveCall(null);
    setCallType(null);
  };

  if (!currentUser || !currentUser.isRegistered) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Ro'yxatdan o'tish</h2>
          <p style={styles.subtitle}>Tizimdan foydalanish uchun ma'lumotlarni kiriting</p>
          <form onSubmit={handleRegister} style={styles.form}>
            <input
              type="text"
              placeholder="Ism va Familiyangiz"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={styles.input}
              required
            />
            <input
              type="tel"
              placeholder="+998901234567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              style={styles.input}
              required
            />
            <button type="submit" style={styles.button}>
              Kirish / Saqlash
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (activeCall) {
    return (
      <div style={styles.callScreen}>
        <div style={styles.videoArea}>
          <div style={styles.topVideoContainer}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={styles.remoteVideo}
            />
            <span style={styles.videoLabel}>Suhbatdoshingiz</span>
          </div>

          <div style={styles.bottomVideoContainer}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={styles.localVideo}
            />
            <span style={styles.videoLabelSmall}>Siz</span>
          </div>
        </div>

        <div style={styles.callControls}>
          <button onClick={handleEndCall} style={styles.endCallBtn}>
            Qo'ng'iroqni tugatish
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.chatLayout}>
      {incomingCall && incomingCall.status === "calling" && !activeCall && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3>Kiruvchi {incomingCall.type === "video" ? "Video" : "Audio"} qo'ng'iroq!</h3>
            <p>Sizga qo'ng'iroq bo'lyapti...</p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button onClick={handleAcceptCall} style={styles.acceptBtn}>Javob berish</button>
              <button onClick={handleEndCall} style={styles.rejectBtn}>Rad etish</button>
            </div>
          </div>
        </div>
      )}

      <div style={styles.sidebar}>
        <div style={styles.profileHeader}>
          <h3 style={{ margin: 0, color: "#333" }}>{currentUser.fullName}</h3>
          <p style={{ fontSize: "12px", color: "#666", margin: "4px 0 0 0" }}>{currentUser.phoneNumber}</p>
        </div>

        <h4 style={{ padding: "10px", margin: 0, color: "#444" }}>Barcha foydalanuvchilar</h4>
        <div style={styles.userList}>
          {allUsers?.map((user) => (
            <div
              key={user._id}
              onClick={() => setSelectedUser(user)}
              style={{
                ...styles.userCard,
                backgroundColor: selectedUser?._id === user._id ? "#eef5fe" : "#fff",
              }}
            >
              <div>
                <strong style={{ color: "#222" }}>{user.fullName}</strong>
                <p style={{ fontSize: "12px", margin: 0, color: "#666" }}>
                  {user.phoneNumber}
                </p>
              </div>

              {!user.isContact && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    addContact({ ownerId: currentUser._id, contactUserId: user._id });
                  }}
                  style={styles.addContactBtn}
                >
                  + Kontakt
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={styles.chatArea}>
        {selectedUser ? (
          <>
            <div style={styles.chatHeader}>
              <div>
                <h4 style={{ margin: 0, color: "#333" }}>{selectedUser.fullName}</h4>
                <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
                  {canChat
                    ? "Siz o'zaro kontaktdasiz"
                    : "Suhbatlashish uchun bir-biringizni kontaktga qo'shishingiz kerak!"}
                </p>
              </div>

              {canChat && (
                <div style={styles.callButtons}>
                  <button onClick={() => handleStartCall("audio")} style={styles.callBtn}>
                    📞 Audio
                  </button>
                  <button onClick={() => handleStartCall("video")} style={styles.callBtn}>
                    📹 Video
                  </button>
                </div>
              )}
            </div>

            <div style={styles.messagesBox}>
              {canChat ? (
                messages?.map((msg) => {
                  const isMe = msg.senderId === currentUser._id;
                  return (
                    <div
                      key={msg._id}
                      style={{
                        ...styles.messageBubble,
                        alignSelf: isMe ? "flex-end" : "flex-start",
                        backgroundColor: isMe ? "#2AABEE" : "#fff",
                        color: isMe ? "#fff" : "#000",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                      }}
                    >
                      {msg.type === "text" && <p style={{ margin: 0 }}>{msg.content}</p>}
                      {msg.type === "sticker" && (
                        <img src={msg.content} alt="Sticker" style={{ width: "100px" }} />
                      )}
                      {msg.type === "gif" && (
                        <img src={msg.content} alt="GIF" style={{ width: "150px", borderRadius: "8px" }} />
                      )}

                      {isMe && (
                        <span style={styles.readStatus}>
                          {msg.isRead ? "✓✓" : "✓"}
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={styles.blockedNotice}>
                  Ushbu foydalanuvchi bilan yozishish uchun har ikkala tomon ham bir-birini kontaktga qo'shgan bo'lishi shart.
                </div>
              )}
            </div>

            {canChat && (
              <div style={styles.inputContainer}>
                {showStickers && (
                  <div style={styles.mediaPicker}>
                    <p style={{ margin: "4px 0", fontSize: "12px", fontWeight: "bold", color: "#333" }}>Stikerlar:</p>
                    <div style={styles.pickerRow}>
                      {["https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3Y2/l3vRfzpA8U1/giphy.gif", "https://media.giphy.com/media/26317283/giphy.gif"].map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt="Sticker item"
                          onClick={() => handleSend("sticker", url)}
                          style={styles.pickerMedia}
                        />
                      ))}
                    </div>
                    <p style={{ margin: "4px 0", fontSize: "12px", fontWeight: "bold", color: "#333" }}>GIF-lar:</p>
                    <div style={styles.pickerRow}>
                      {["https://media.giphy.com/media/d2ZdNp62w69W/giphy.gif", "https://media.giphy.com/media/3o7TKsjRrfIPjeiVyM/giphy.gif"].map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt="GIF item"
                          onClick={() => handleSend("gif", url)}
                          style={styles.pickerMedia}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                  <button onClick={() => setShowStickers(!showStickers)} style={styles.iconBtn}>
                    😊
                  </button>
                  <input
                    type="text"
                    placeholder="Xabar yozing..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    style={styles.chatInput}
                  />
                  <button onClick={() => handleSend()} style={styles.sendBtn}>
                    Yuborish
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={styles.emptyChat}>Suhbatlashish uchun user tanlang</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "#f0f2f5" },
  card: { padding: "24px", backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", textAlign: "center", width: "320px" },
  title: { margin: "0 0 8px 0", color: "#222" },
  subtitle: { fontSize: "12px", color: "#555", marginBottom: "16px" },
  form: { display: "flex", flexDirection: "column", gap: "12px" },
  input: { padding: "10px", borderRadius: "6px", border: "1px solid #ccc", outline: "none", color: "#000", backgroundColor: "#fff" },
  button: { padding: "10px", backgroundColor: "#2AABEE", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" },
  
  chatLayout: { display: "flex", height: "100vh", fontFamily: "sans-serif" },
  sidebar: { width: "300px", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column", backgroundColor: "#fff" },
  profileHeader: { padding: "16px", backgroundColor: "#f8f9fa", borderBottom: "1px solid #ddd" },
  userList: { overflowY: "auto", flex: 1 },
  userCard: { padding: "12px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" },
  addContactBtn: { fontSize: "11px", padding: "4px 8px", backgroundColor: "#e2f3ff", color: "#0088cc", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" },
  
  chatArea: { flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#e6ebeef0" },
  chatHeader: { padding: "12px 20px", backgroundColor: "#fff", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" },
  callButtons: { display: "flex", gap: "8px" },
  callBtn: { padding: "6px 12px", border: "none", backgroundColor: "#f0f0f0", borderRadius: "6px", cursor: "pointer", color: "#333" },
  
  messagesBox: { flex: 1, padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" },
  messageBubble: { padding: "8px 12px", borderRadius: "10px", maxWidth: "60%", position: "relative" },
  readStatus: { fontSize: "10px", marginLeft: "6px", float: "right" },
  blockedNotice: { margin: "auto", backgroundColor: "#fff", padding: "12px", borderRadius: "8px", textAlign: "center", color: "#d9534f", maxWidth: "300px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" },
  emptyChat: { margin: "auto", color: "#666", fontWeight: "500" },
  
  inputContainer: { padding: "12px", backgroundColor: "#fff", borderTop: "1px solid #ddd", position: "relative" },
  chatInput: { flex: 1, padding: "10px", border: "1px solid #ddd", borderRadius: "20px", outline: "none", color: "#000", backgroundColor: "#fff" },
  sendBtn: { padding: "10px 16px", backgroundColor: "#2AABEE", color: "#fff", border: "none", borderRadius: "20px", cursor: "pointer", fontWeight: "bold" },
  iconBtn: { border: "none", background: "none", fontSize: "20px", cursor: "pointer" },
  
  mediaPicker: { position: "absolute", bottom: "60px", left: "12px", backgroundColor: "#fff", border: "1px solid #ccc", padding: "8px", borderRadius: "8px", width: "250px", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" },
  pickerRow: { display: "flex", gap: "8px", overflowX: "auto" },
  pickerMedia: { width: "50px", height: "50px", objectFit: "cover", cursor: "pointer", borderRadius: "4px" },

  callScreen: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#1c1c1e", display: "flex", flexDirection: "column", zIndex: 2000 },
  videoArea: { flex: 1, position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%" },
  topVideoContainer: { width: "100%", height: "100%", backgroundColor: "#000", position: "relative" },
  remoteVideo: { width: "100%", height: "100%", objectFit: "cover" },
  bottomVideoContainer: { position: "absolute", bottom: "80px", right: "20px", width: "140px", height: "200px", borderRadius: "12px", overflow: "hidden", border: "2px solid rgba(255,255,255,0.8)", boxShadow: "0 4px 12px rgba(0,0,0,0.4)", backgroundColor: "#222" },
  localVideo: { width: "100%", height: "100%", objectFit: "cover" },
  videoLabel: { position: "absolute", top: "15px", left: "15px", backgroundColor: "rgba(0,0,0,0.5)", color: "#fff", padding: "4px 10px", borderRadius: "6px", fontSize: "12px" },
  videoLabelSmall: { position: "absolute", bottom: "5px", left: "5px", backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "10px" },
  callControls: { padding: "16px", display: "flex", justifyContent: "center", backgroundColor: "#111" },
  endCallBtn: { padding: "12px 28px", backgroundColor: "#ff3b30", color: "#fff", border: "none", borderRadius: "30px", cursor: "pointer", fontWeight: "bold", fontSize: "15px" },

  modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modalCard: { backgroundColor: "#fff", padding: "20px", borderRadius: "10px", textAlign: "center", width: "300px", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" },
  acceptBtn: { padding: "8px 16px", backgroundColor: "#5cb85c", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" },
  rejectBtn: { padding: "8px 16px", backgroundColor: "#d9534f", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }
};
.


