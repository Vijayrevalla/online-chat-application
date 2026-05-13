import { useEffect, useRef, useState } from "react";
import { MdAttachFile, MdClose, MdEmojiEmotions, MdSend, MdDelete, MdCleaningServices } from "react-icons/md";
import useChatContext from "../context/ChatContext";
import { useNavigate } from "react-router";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";
import toast from "react-hot-toast";
import { baseURL } from "../config/AxiosHelper";
import { getMessagess, clearChatApi } from "../services/RoomService";
import { timeAgo } from "../config/helper";

const EMOJI_CATEGORIES = [
  {
    name: "Faces",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "🤨", "🧐", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "🤗", "🤔", "🤭", "🤫", "😶", "😐", "😑", "😬", "🙄", "😯", "🥱", "😴", "🤤", "😵", "🤐", "🥴", "🤢", "🤮", "😷"],
  },
  {
    name: "Hearts/Gestures",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "👋", "🤚", "🖐️", "✋", "🖖", "👌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "💪", "🤳"],
  },
  {
    name: "Party/Vibe",
    emojis: ["✨", "🔥", "🎉", "🎊", "🎂", "🎈", "🎨", "🎭", "🎪", "🎟️", "🏆", "🏅", "🥇", "⚽", "🎮", "🎲", "🧩", "🚀", "🛸", "🪐", "⭐", "🌟", "🌈", "⛅", "⚡", "❄️", "💧", "🌊", "🍕", "🍔", "🍟", "🍺", "🍷", "☕", "🍩", "🍎"],
  }
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB (base64 expands ~33%, keep safe for STOMP frames)

const formatFileSize = (size) => {
  if (!size) return "0 KB";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getAvatarLabel = (name = "U") => name.trim().charAt(0).toUpperCase() || "U";

const ensureHttps = (url) => {
  if (!url) return url;
  let sanitized = url;
  
  // Do NOT force HTTPS for local development hosts
  if (sanitized.includes("localhost") || sanitized.includes("127.0.0.1")) {
    return sanitized;
  }
  
  if (sanitized.startsWith("http://")) {
    sanitized = sanitized.replace("http://", "https://");
  }
  if (sanitized.includes("onrender.com")) {
    sanitized = sanitized.replace(/onrender\.com:\d+/, "onrender.com");
  }
  return sanitized;
};

const ChatPage = () => {
  const {
    roomId,
    currentUser,
    currentUserAvatar,
    connected,
    setConnected,
    setRoomId,
    setCurrentUser,
  } = useChatContext();

  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [stompClient, setStompClient] = useState(null);
  const [isStompConnected, setIsStompConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("DISCONNECTED");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [incomingCallOffer, setIncomingCallOffer] = useState(null);
  const callPeerConnectionRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const cameraVideoRef = useRef(null);
  const cameraCaptureVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const cameraCaptureStreamRef = useRef(null);
  const pendingCallSignalsRef = useRef([]);
  const chatBoxRef = useRef(null);
  const fileInputRef = useRef(null);
  const stompSubscriptionRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const stompClientRef = useRef(null);
  const isStompConnectedRef = useRef(false);
  const pendingCallToastIdRef = useRef(null);

  useEffect(() => {
    stompClientRef.current = stompClient;
  }, [stompClient]);

  useEffect(() => {
    isStompConnectedRef.current = isStompConnected;
  }, [isStompConnected]);

  useEffect(() => {
    if (!connected) {
      navigate("/", { replace: true });
    }
  }, [connected, navigate]);

  useEffect(() => {
    async function loadMessages() {
      try {
        const previousMessages = await getMessagess(roomId);
        setMessages(previousMessages);
      } catch (error) {
        console.error("Failed to load room messages", error);
        toast.error("Failed to load previous messages");
      }
    }

    if (connected && roomId) {
      loadMessages();
    }
  }, [connected, roomId]);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scroll({
        top: chatBoxRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  const isStompReady = () => {
    const currentClient = stompClientRef.current;
    return (
      currentClient &&
      (currentClient.active || currentClient.connected || isStompConnectedRef.current)
    );
  };

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (video && localStream) {
      if (video.srcObject !== localStream) {
        video.srcObject = localStream;
        video.muted = true;
        video.play().catch(err => {
          if (err.name !== "AbortError") console.warn("Local video play failed", err);
        });
      }
    } else if (video) {
      video.srcObject = null;
    }
  }, [localStream, isVideoCallActive]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video && remoteStream) {
      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
        video.play().catch(err => {
          if (err.name !== "AbortError") console.warn("Remote video play failed", err);
        });
      }
    } else if (video) {
      video.srcObject = null;
    }
  }, [remoteStream, isVideoCallActive]);

  useEffect(() => {
    if (!isStompReady() || !pendingCallSignalsRef.current || pendingCallSignalsRef.current.length === 0) {
      return;
    }

    // Grab a snapshot and clear the buffer
    const pendingList = [...pendingCallSignalsRef.current];
    pendingCallSignalsRef.current = [];

    let successCount = 0;
    pendingList.forEach((signal) => {
      try {
        stompClientRef.current.publish({
          destination: `/app/call/${roomId}`,
          body: JSON.stringify(signal),
        });
        successCount++;
      } catch (err) {
        console.error("Failed to send pending call signal", err);
        // Put back in queue for next try
        pendingCallSignalsRef.current.push(signal);
      }
    });

    if (successCount > 0) {
      if (pendingCallToastIdRef.current) {
        toast.dismiss(pendingCallToastIdRef.current);
        pendingCallToastIdRef.current = null;
      }
      toast.success(`Forwarded ${successCount} buffered call signal(s).`);
    }
  }, [isStompConnected, stompClient, roomId]);

  useEffect(() => {
    if (!connected || !roomId) {
      return undefined;
    }

    setIsStompConnected(false);
    setConnectionStatus("CONNECTING");

    const client = new Client({
      webSocketFactory: () => new SockJS(`${baseURL}/chat`),
      reconnectDelay: 3000,
      heartbeatIncoming: 25000,
      heartbeatOutgoing: 25000,
      onConnect: () => {
        // Room messages
        if (stompSubscriptionRef.current) {
          if (stompSubscriptionRef.current.messagesSub) {
            stompSubscriptionRef.current.messagesSub.unsubscribe();
          }
          if (stompSubscriptionRef.current.typingSub) {
            stompSubscriptionRef.current.typingSub.unsubscribe();
          }
          stompSubscriptionRef.current = null;
        }

        const messagesSub = client.subscribe(`/topic/room/${roomId}`, (message) => {
          const newMessage = JSON.parse(message.body);

          if (newMessage.type === "TYPING") {
            return;
          }

          if (newMessage.type === "JOIN") {
            setOnlineUsers((prev) => {
              if (prev.some((u) => u.name === newMessage.user)) return prev;
              return [...prev, { name: newMessage.user, avatar: newMessage.avatar }];
            });
            
            // Handshake Discovery: If someone else joined, echo my presence so they discover me!
            if (newMessage.user !== currentUser) {
              client.publish({
                destination: `/app/userPresence/${roomId}`,
                body: JSON.stringify({ user: currentUser, type: "JOIN", avatar: currentUserAvatar }),
              });
            }
            return;
          }

          if (newMessage.type === "LEAVE") {
            setOnlineUsers((prev) => prev.filter((u) => u.name !== newMessage.user));
            return;
          }

          if (newMessage.type === "CLEAR_CHAT") {
            setMessages([]);
            toast.success("Chat history cleared.");
            return;
          }

          if (newMessage.messageType === "DELETE") {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === newMessage.id ? { ...msg, ...newMessage } : msg))
            );
            return;
          }

          if (newMessage.type === "VIDEO_CALL" || newMessage.type === "OFFER" || newMessage.type === "ANSWER" || newMessage.type === "ICE") {
            processIncomingCallSignal(newMessage);
            return;
          }

          setMessages((prev) => [...prev, newMessage]);
        });

        // Typing notifications
        const typingSub = client.subscribe(`/topic/room/${roomId}/typing`, (message) => {
          const username = message.body;
          setTypingUsers((prev) => {
            if (username === currentUser) return prev;
            if (!prev.includes(username)) {
              return [...prev, username];
            }
            return prev;
          });

          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUsers((prev) => prev.filter((user) => user !== username));
          }, 1500);
        });

        setStompClient(client);
        setIsStompConnected(true);
        setConnectionStatus("CONNECTED");
        toast.success("Connected to chat server.");

        // broadcast presence with avatar
        client.publish({
          destination: `/app/userPresence/${roomId}`,
          body: JSON.stringify({ user: currentUser, type: "JOIN", avatar: currentUserAvatar }),
        });


        stompSubscriptionRef.current = { messagesSub, typingSub };
      },
      onStompError: (frame) => {
        console.error("STOMP error", frame);
        setIsStompConnected(false);
        setConnectionStatus("DISCONNECTED");
        toast.error("STOMP error occurred. Reconnecting...");
      },
      onWebSocketClose: () => {
        console.warn("STOMP websocket closed");
        setIsStompConnected(false);
        setConnectionStatus("DISCONNECTED");
        toast.error("Chat socket closed. Reconnecting...");
      },
      onWebSocketError: (evt) => {
        console.error("WebSocket error", evt);
      },
      debug: () => {
        // called with debug messages, left intentionally empty to reduce noise
      },
    });

    client.activate();

    return () => {
      if (stompSubscriptionRef.current) {
        if (stompSubscriptionRef.current.messagesSub) {
          stompSubscriptionRef.current.messagesSub.unsubscribe();
        }
        if (stompSubscriptionRef.current.typingSub) {
          stompSubscriptionRef.current.typingSub.unsubscribe();
        }
        stompSubscriptionRef.current = null;
      }
      if (client && client.active) {
        client.deactivate();
      }
      setStompClient(null);
      setIsStompConnected(false);
      setConnectionStatus("DISCONNECTED");
    };
  }, [connected, roomId]);

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleEmojiSelect = (emoji) => {
    setInput((prev) => `${prev}${emoji}`);
    setShowEmojiPicker(false);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast.error(`Please choose a file smaller than ${formatFileSize(MAX_FILE_SIZE)}.`);
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      console.log("Selected file for upload", {
        name: file.name,
        type: file.type,
        sizeBytes: file.size,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2),
        dataUrlLength: dataUrl?.length || 0,
      });

      // Reject payloads that will likely break STOMP or broker limits.
      if (dataUrl && dataUrl.length > 50_000_000) {
        toast.error("File data is too large for websocket transfer; please use a smaller file.");
        event.target.value = "";
        return;
      }

      setSelectedFile({
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl,
        fileObj: file,
        isImage: file.type.startsWith("image/"),
        isVideo: file.type.startsWith("video/"),
        size: file.size,
      });
      toast.success(`${file.name} attached`);
    };
    reader.onerror = () => {
      toast.error("Unable to read the selected file.");
      event.target.value = "";
    };
    reader.readAsDataURL(file);
  };

  const uploadAttachment = async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${baseURL}/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    const data = await response.json();
    return data.url;
  };

  const sendMessage = async () => {
    if (!isStompReady()) {
      toast.error("Chat server is not connected. Please wait for connection.");
      return;
    }

    const trimmedInput = input.trim();
    if (!trimmedInput && !selectedFile) {
      return;
    }

    let attachmentUrl = selectedFile?.dataUrl || null;

    if (selectedFile?.fileObj) {
      try {
        attachmentUrl = await uploadAttachment(selectedFile.fileObj);
      } catch (error) {
        console.error("Attachment upload failed", error);
        toast.error("Unable to upload attachment. Try a smaller file.");
        return;
      }
    }

    const messageType = selectedFile
      ? selectedFile.isImage
        ? "IMAGE"
        : selectedFile.isVideo
        ? "VIDEO"
        : selectedFile.type?.startsWith("audio/")
        ? "VOICE"
        : "FILE"
      : "TEXT";

    const message = {
      sender: currentUser,
      content: trimmedInput,
      roomId,
      messageType,
      fileName: selectedFile?.name || null,
      fileType: selectedFile?.type || null,
      fileData: attachmentUrl,
      senderAvatar: currentUserAvatar,
    };

    try {
      stompClientRef.current.publish({
        destination: `/app/sendMessage/${roomId}`,
        body: JSON.stringify(message),
      });
      setInput("");
      clearSelectedFile();
      setShowEmojiPicker(false);
    } catch (error) {
      console.error("Failed to send STOMP message", error);
      toast.error("Failed to send message. Reconnect and try again.");
    }
  };

  const handleDeleteMessage = (messageId) => {
    if (!isStompReady()) {
      toast.error("Chat server not connected.");
      return;
    }
    if (!window.confirm("Delete message for everyone?")) {
      return;
    }
    try {
      stompClientRef.current.publish({
        destination: `/app/deleteMessage/${roomId}`,
        body: JSON.stringify({ messageId }),
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete message.");
    }
  };

  const handleClearChat = async () => {
    if (!window.confirm("🚨 Are you sure you want to permanently clear this room's chat history? This deletes all database records!")) {
      return;
    }
    try {
      await clearChatApi(roomId);
      
      if (isStompReady()) {
        stompClientRef.current.publish({
          destination: `/app/clearChat/${roomId}`,
          body: JSON.stringify({ type: "CLEAR_CHAT", user: currentUser }),
        });
      }
      
      setMessages([]);
      toast.success("Chat cleared successfully.");
    } catch (err) {
      console.error(err);
      toast.error("Could not clear chat logs.");
    }
  };

  const notifyTyping = () => {
    if (!isStompReady()) {
      return;
    }

    stompClientRef.current.publish({
      destination: `/app/typing/${roomId}`,
      body: currentUser,
    });
  };

  const sendCallSignal = (signal) => {
    if (!signal) return;

    if (!isStompReady()) {
      pendingCallSignalsRef.current.push(signal);
      if (pendingCallSignalsRef.current.length === 1) {
        if (!pendingCallToastIdRef.current) {
          pendingCallToastIdRef.current = toast.loading("Chat paused. Resending call signal once reconnected.");
        }
      }
      return;
    }

    try {
      stompClientRef.current.publish({
        destination: `/app/call/${roomId}`,
        body: JSON.stringify(signal),
      });
    } catch (err) {
      console.error("Unable to publish call signal", err);
      pendingCallSignalsRef.current.push(signal);
    }
  };

  const flushPendingIceCandidates = async () => {
    const pc = callPeerConnectionRef.current;
    if (!pc || !pc.remoteDescription) return;
    
    const candidates = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    
    for (const cand of candidates) {
      try {
        await pc.addIceCandidate(cand);
      } catch (err) {
        console.error("Failed to flush ICE candidate", err);
      }
    }
  };

  const processIncomingCallSignal = async (signal) => {
    if (!signal || !signal.type) return;

    // Ignore our own signaling messages to avoid echo-processing bugs
    if (signal.from === currentUser) {
      return;
    }

    if (signal.type === "OFFER") {
      setIncomingCallOffer(signal);
      toast("Incoming video call...", { icon: "📞", duration: 8000 });
      return;
    }

    if (signal.type === "ANSWER") {
      if (callPeerConnectionRef.current && signal.sdp) {
        try {
          await callPeerConnectionRef.current.setRemoteDescription(signal.sdp);
          await flushPendingIceCandidates();
        } catch (err) {
          console.error("Error setting remote description on answer", err);
        }
      }
      return;
    }

    if (signal.type === "ICE") {
      const pc = callPeerConnectionRef.current;
      if (pc && signal.candidate) {
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(signal.candidate);
          } else {
            pendingIceCandidatesRef.current.push(signal.candidate);
          }
        } catch (err) {
          console.error("Failed to add ICE candidate", err);
        }
      }
      return;
    }
  };

  const initiateCallReception = async (signal) => {
    if (!window.navigator.mediaDevices) {
      toast.error("WebRTC is not supported in this browser.");
      return;
    }

    pendingIceCandidatesRef.current = []; // Reset candidate queue for new call

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ontrack = (event) => {
      const remote = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      setRemoteStream((prev) => {
        if (prev) return prev;
        return remote;
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendCallSignal({
          type: "ICE",
          candidate: event.candidate,
          from: currentUser,
        });
      }
    };

    cleanupCameraCaptureStream();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.error("initiateCallReception getUserMedia failed", err);
      if (err.name === "NotReadableError" || err.name === "NotAllowedError") {
        toast.error("Camera/microphone device is busy or permission denied.");
      } else {
        toast.error("Failed to access camera/microphone to answer call.");
      }
      return;
    }


    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    setLocalStream(stream);

    callPeerConnectionRef.current = pc; // Must set Ref before remoteDescription to allow flushing
    
    try {
      await pc.setRemoteDescription(signal.sdp);
      await flushPendingIceCandidates();
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      setIsVideoCallActive(true);
      
      sendCallSignal({ type: "ANSWER", sdp: pc.localDescription, from: currentUser });
    } catch (err) {
      console.error("Error completing call handshake", err);
      toast.error("Failed to establish secure video connection.");
    }
  };

  const startVideoCall = async () => {
    if (!window.navigator.mediaDevices) {
      toast.error("WebRTC is not supported in this browser.");
      return;
    }

    if (isVideoCallActive || localStream) {
      toast.error("A video call is already active.");
      return;
    }

    pendingIceCandidatesRef.current = []; // Reset queue for new call session
    cleanupCameraCaptureStream();

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.error("startVideoCall getUserMedia failed", err);
      if (err.name === "NotReadableError" || err.name === "NotAllowedError") {
        toast.error("Camera/microphone device is busy or permission denied.");
      } else {
        toast.error("Failed to access camera/microphone for call.");
      }
      return;
    }


    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      const remote = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      setRemoteStream((prev) => {
        if (prev) return prev;
        return remote;
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendCallSignal({
          type: "ICE",
          candidate: event.candidate,
          from: currentUser,
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendCallSignal({ type: "OFFER", sdp: pc.localDescription, from: currentUser });

    setLocalStream(stream);
    callPeerConnectionRef.current = pc;
    setIsVideoCallActive(true);
  };

  const cleanupCameraCaptureStream = () => {
    if (cameraCaptureStreamRef.current) {
      cameraCaptureStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraCaptureStreamRef.current = null;
    }
    if (cameraCaptureVideoRef.current) {
      cameraCaptureVideoRef.current.srcObject = null;
    }
  };

  const endVideoCall = () => {
    cleanupCameraCaptureStream();

    if (callPeerConnectionRef.current) {
      callPeerConnectionRef.current.close();
      callPeerConnectionRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
      setRemoteStream(null);
    }
    setIsVideoCallActive(false);
  };

  const captureCameraPhoto = async () => {
    if (isVideoCallActive || localStream) {
      toast.error("Cannot capture photo while video call is active.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera not available in this browser.");
      return;
    }

    cleanupCameraCaptureStream();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraCaptureStreamRef.current = stream;

      if (cameraCaptureVideoRef.current) {
        cameraCaptureVideoRef.current.srcObject = stream;
        await cameraCaptureVideoRef.current.play();
      }

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext("2d");

      if (!cameraCaptureVideoRef.current) {
        throw new Error("Camera preview element is not available.");
      }

      await new Promise((resolve) => {
        if (cameraCaptureVideoRef.current.readyState >= 2) {
          resolve();
          return;
        }
        const loadedDataHandler = () => {
          cameraCaptureVideoRef.current?.removeEventListener("loadeddata", loadedDataHandler);
          resolve();
        };
        cameraCaptureVideoRef.current.addEventListener("loadeddata", loadedDataHandler);
        setTimeout(resolve, 1200);
      });

      if (!cameraCaptureVideoRef.current.videoWidth || !cameraCaptureVideoRef.current.videoHeight) {
        throw new Error("Video stream not ready for capture. Please try again.");
      }

      context.drawImage(cameraCaptureVideoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });

      setSelectedFile({
        name: file.name,
        type: file.type,
        dataUrl,
        isImage: true,
        isVideo: false,
        size: blob.size,
        fileObj: file,
      });

      toast.success("Photo captured");
    } catch (err) {
      console.error("captureCameraPhoto error", err);
      if (err.name === "NotReadableError" || err.name === "NotAllowedError") {
        toast.error("Camera device currently in use or access denied.");
      } else {
        toast.error("Failed to capture photo from camera.");
      }
    } finally {
      cleanupCameraCaptureStream();
    }
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Microphone not available.");
      return;
    }

    if (isRecording) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      setRecordedAudioUrl(url);
      setSelectedFile({
        name: `voice-${Date.now()}.webm`,
        type: "audio/webm",
        dataUrl: url,
        isImage: false,
        isVideo: false,
        size: blob.size,
        fileObj: blob,
      });
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    setIsRecording(true);

    setTimeout(() => {
      mediaRecorder.stop();
      setIsRecording(false);
    }, 8000);
  };

  const stopVoiceRecording = () => {
    setIsRecording(false);
  };

  const renderTypingIndicator = () => {
    if (typingUsers.length === 0) return null;
    const names = typingUsers.join(", ");
    return <p className="text-xs italic text-gray-400">{names} typing...</p>;
  };

  const renderOnlineUsers = () => {
    if (!onlineUsers || onlineUsers.length === 0) return null;
    return (
      <div className="p-2 bg-gray-800 rounded">
        <p className="text-xs text-gray-300">Online: {onlineUsers.length}</p>
        {onlineUsers.map((user) => (
          <p key={user} className="text-sm text-gray-200">• {user}</p>
        ))}
      </div>
    );
  };

  const handleDownload = async (fileUrl, fileName) => {
    try {
      const response = await fetch(ensureHttps(fileUrl));
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName || "download";
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
      toast.success("Download started");
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to download file");
    }
  };

  const renderMessageContent = (message) => {
    const messageType = message.messageType || "TEXT";

    if (message.isDeleted || messageType === "DELETE") {
      return (
        <span className="italic text-slate-400/80 text-[13px] flex items-center gap-1 select-none">
          🚫 This message was deleted
        </span>
      );
    }

    if (messageType === "IMAGE" && message.fileData) {
      const secureUrl = ensureHttps(message.fileData);
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <img
            className="max-h-64 w-full rounded-lg object-cover cursor-pointer hover:opacity-90 transition"
            src={secureUrl}
            alt={message.fileName || "shared image"}
            onClick={() => window.open(secureUrl, "_blank")}
          />
          <button
            onClick={() => handleDownload(secureUrl, message.fileName || "image.jpg")}
            className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
          >
            ⬇️ Download Image
          </button>
        </div>
      );
    }

    if (messageType === "VIDEO" && message.fileData) {
      const secureUrl = ensureHttps(message.fileData);
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <video
            className="max-h-64 w-full rounded-lg object-cover"
            controls
            src={secureUrl}
          />
          <button
            onClick={() => handleDownload(secureUrl, message.fileName || "video.mp4")}
            className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
          >
            ⬇️ Download Video
          </button>
        </div>
      );
    }

    if (messageType === "FILE" && message.fileData) {
      const secureUrl = ensureHttps(message.fileData);
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <button
            onClick={() => handleDownload(secureUrl, message.fileName || "attachment")}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm text-white font-semibold break-all transition"
          >
            📎 {message.fileName || "Download File"}
          </button>
          {message.fileType ? (
            <p className="text-xs text-gray-300">{message.fileType}</p>
          ) : null}
        </div>
      );
    }

    if (messageType === "VOICE" && message.fileData) {
      const secureUrl = ensureHttps(message.fileData);
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <audio controls src={secureUrl} className="w-full" />
          <button
            onClick={() => handleDownload(secureUrl, message.fileName || "audio.webm")}
            className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
          >
            ⬇️ Download Audio
          </button>
        </div>
      );
    }

    return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
  };

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const cameraLiveRef = useRef(null);

  const openCamera = async () => {
    if (isVideoCallActive || localStream) {
      toast.error("Cannot capture photo while video call is active.");
      return;
    }
    setIsCameraOpen(true);
    setTimeout(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (cameraLiveRef.current) {
          cameraLiveRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Failed to open camera", err);
        toast.error("Failed to open camera. Check permissions.");
        setIsCameraOpen(false);
      }
    }, 100);
  };

  const closeCamera = () => {
    if (cameraLiveRef.current && cameraLiveRef.current.srcObject) {
      cameraLiveRef.current.srcObject.getTracks().forEach((track) => track.stop());
      cameraLiveRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhotoFromPreview = () => {
    if (!cameraLiveRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    context.drawImage(cameraLiveRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    const blobBin = atob(dataUrl.split(",")[1]);
    const array = [];
    for (let i = 0; i < blobBin.length; i++) {
      array.push(blobBin.charCodeAt(i));
    }
    const file = new File([new Uint8Array(array)], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });

    setSelectedFile({
      name: file.name,
      type: file.type,
      dataUrl,
      isImage: true,
      isVideo: false,
      size: file.size,
      fileObj: file,
    });

    toast.success("Photo captured!");
    closeCamera();
  };

  function handleLogout() {
    const currentClient = stompClientRef.current;
    if (currentClient?.active) {
      currentClient.publish({
        destination: `/app/userPresence/${roomId}`,
        body: JSON.stringify({ user: currentUser, type: "LEAVE" }),
      });
      currentClient.deactivate();
      setStompClient(null);
    }
    setConnected(false);
    setRoomId("");
    setCurrentUser("");
    navigate("/");
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      {/* Premium Sticky Header */}
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-slate-900/80 backdrop-blur-md px-4 py-4 md:py-5 shadow-lg flex flex-col md:flex-row gap-3 justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight">
            Room: <span className="bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent font-extrabold">{roomId}</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3 md:gap-6">
          {/* Live Online Avatars Stack */}
          {onlineUsers.length > 0 && (
            <div className="flex items-center -space-x-2 hover:space-x-1 transition-all duration-300 cursor-help select-none mr-2 md:mr-0">
              {onlineUsers.slice(0, 5).map((u, idx) => (
                <div
                  key={`${u.name}-${idx}`}
                  className="relative h-8 w-8 rounded-full bg-slate-700 border border-slate-900 shadow-md shrink-0 flex items-center justify-center overflow-hidden group"
                >
                  {u.avatar ? (
                    <img src={ensureHttps(u.avatar)} alt={u.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-bold text-slate-300 uppercase">{u.name?.charAt(0)}</span>
                  )}
                  <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-950 text-white text-[9px] font-medium tracking-wider px-1.5 py-0.5 rounded-md border border-white/10 whitespace-nowrap z-50 transition shadow-xl">
                    {u.name}
                  </div>
                </div>
              ))}
              {onlineUsers.length > 5 && (
                <div className="h-8 w-8 rounded-full bg-indigo-600 border border-slate-900 shadow-md shrink-0 flex items-center justify-center text-[9px] font-bold text-indigo-100 relative z-10">
                  +{onlineUsers.length - 5}
                </div>
              )}
            </div>
          )}

          <div className="bg-white/5 border border-white/10 px-3 py-1 rounded-full text-xs md:text-sm flex items-center gap-1.5">
            <span className="text-slate-400">User:</span>
            <span className="font-semibold text-blue-300">{currentUser}</span>
          </div>

          <div className="text-xs md:text-sm flex items-center gap-1.5">
            <span className="text-slate-400">Status:</span>
            <span
              className={`font-semibold px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${
                connectionStatus === "CONNECTED"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : connectionStatus === "CONNECTING"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
              }`}
            >
              {connectionStatus}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={handleClearChat}
            className="flex-1 md:flex-initial px-3.5 py-2 bg-amber-500/10 hover:bg-amber-600 border border-amber-500/20 hover:border-transparent text-amber-200 hover:text-white rounded-xl text-sm font-semibold transition-all duration-300 active:scale-95 flex items-center justify-center gap-1.5"
            title="Clear Room History"
          >
            <MdCleaningServices size={15} />
            <span className="md:hidden lg:inline text-xs uppercase tracking-wider font-bold">Clear Chat</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 md:flex-initial px-4 py-2 bg-rose-500/10 hover:bg-rose-600 border border-rose-500/20 hover:border-transparent text-rose-200 hover:text-white rounded-xl text-sm font-semibold transition-all duration-300 active:scale-95 text-xs uppercase tracking-wider"
          >
            Leave Room
          </button>
        </div>
      </header>

      {/* Main Chat Box */}
      <main
        ref={chatBoxRef}
        className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-4 max-w-4xl mx-auto w-full pb-28"
      >
        {messages.map((message, index) => (
          <div
            key={`${message.timeStamp || "message"}-${index}`}
            className={`flex ${message.sender === currentUser ? "justify-end" : "justify-start"} animate-fade-in`}
          >
            <div
              className={`flex items-start gap-3 max-w-[85%] md:max-w-[70%] p-3.5 rounded-2xl shadow-xl transition-all ${
                message.sender === currentUser
                  ? "bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-tr-none"
                  : "bg-slate-900 border border-white/5 text-slate-100 rounded-tl-none"
              }`}
            >
              <div className="h-9 w-9 rounded-full overflow-hidden border border-white/10 flex items-center justify-center bg-slate-800 text-slate-200 font-bold text-sm shrink-0 shadow-md">
                {message.senderAvatar ? (
                  <img src={ensureHttps(message.senderAvatar)} className="h-full w-full object-cover" alt={message.sender} />
                ) : (
                  getAvatarLabel(message.sender)
                )}
              </div>
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-semibold text-blue-300 truncate">{message.sender}</span>
                  
                  {/* WhatsApp-style Deletion Hook */}
                  {message.sender === currentUser && !message.isDeleted && message.messageType !== "DELETE" && message.id && (
                    <button
                      onClick={() => handleDeleteMessage(message.id)}
                      className="text-slate-400 hover:text-rose-400 transition p-0.5 opacity-50 hover:opacity-100"
                      title="Delete message for everyone"
                    >
                      <MdDelete size={13} />
                    </button>
                  )}
                </div>
                <div className="text-sm leading-relaxed">{renderMessageContent(message)}</div>
                <span className="text-[10px] text-slate-400 mt-1 self-end opacity-60">{timeAgo(message.timeStamp)}</span>
              </div>
            </div>
          </div>
        ))}
      </main>

      {/* Camera Preview Modal */}
      {isCameraOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-900 border border-white/10 p-5 rounded-2xl w-full max-w-md shadow-2xl relative space-y-4 animate-slide-up">
            <button
              onClick={closeCamera}
              className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition"
            >
              <MdClose size={18} />
            </button>
            <h3 className="text-lg font-bold text-blue-400">Capture Picture</h3>
            <div className="aspect-video bg-black rounded-xl overflow-hidden relative border border-white/5">
              <video
                ref={cameraLiveRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
            </div>
            <button
              onClick={capturePhotoFromPreview}
              className="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold rounded-xl transition"
            >
              📸 Capture Photo
            </button>
          </div>
        </div>
      ) : null}

      {/* Video Call Overlay */}
      {isVideoCallActive ? (
        <div className="fixed bottom-24 right-4 bg-slate-900/95 border border-white/10 rounded-2xl p-4 shadow-2xl z-40 max-w-xs animate-slide-up">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-2 text-slate-400">Video Call</h2>
          <div className="flex gap-2">
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              muted
              className="w-24 h-18 bg-black rounded-lg border border-white/5"
            />
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-24 h-18 bg-black rounded-lg border border-white/5"
              />
            ) : (
              <div className="w-24 h-18 bg-slate-800 rounded-lg flex items-center justify-center text-[10px] text-slate-400">Waiting...</div>
            )}
          </div>
          <button
            onClick={endVideoCall}
            className="mt-3 w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition"
          >
            End Call
          </button>
        </div>
      ) : null}

      {renderTypingIndicator()}

      {/* Incoming Call Popup Overlay (Bypasses User-Gesture / Autoplay Restrictions) */}
      {incomingCallOffer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
          <div className="bg-slate-900 border-2 border-emerald-500/30 p-6 rounded-3xl w-full max-w-sm shadow-2xl text-center space-y-6 scale-100 animate-in zoom-in-95 duration-200">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <span className="text-3xl animate-pulse">📞</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-100">Incoming Call</h3>
              <p className="text-sm text-slate-400 mt-1">
                <span className="text-emerald-400 font-semibold">{incomingCallOffer.from}</span> wants to video chat
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setIncomingCallOffer(null)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition active:scale-95 border border-white/5"
              >
                Decline
              </button>
              <button
                onClick={async () => {
                  const offer = incomingCallOffer;
                  setIncomingCallOffer(null);
                  await initiateCallReception(offer);
                }}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold rounded-xl transition active:scale-95 shadow-lg shadow-emerald-500/20"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Sticky Input Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent">
        <div className="max-w-4xl mx-auto bg-slate-900/90 border border-white/10 rounded-2xl p-2.5 backdrop-blur-md shadow-2xl flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar,.csv,.xlsx,.xls"
          />

          {selectedFile ? (
            <div className="mx-2 p-2 rounded-xl bg-white/5 border border-white/5 text-xs flex items-center justify-between gap-3 animate-fade-in">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-200">{selectedFile.name}</p>
                <p className="text-[10px] text-slate-400">{formatFileSize(selectedFile.size)}</p>
              </div>
              <button onClick={clearSelectedFile} type="button" className="text-slate-400 hover:text-white">
                <MdClose size={16} />
              </button>
            </div>
          ) : null}

          {/* Categorized Scrollable Emoji Picker Panel */}
          {showEmojiPicker ? (
            <div className="mx-2 bg-slate-950/95 border border-white/10 rounded-xl p-3.5 animate-slide-up max-h-56 overflow-y-auto space-y-4 backdrop-blur-xl shadow-inner custom-scrollbar select-none z-50">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.name} className="space-y-1.5">
                  <p className="text-[9px] uppercase tracking-widest font-extrabold text-blue-400/80">{category.name}</p>
                  <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-1.5">
                    {category.emojis.map((emo, idx) => (
                      <button
                        key={`${emo}-${idx}`}
                        type="button"
                        onClick={() => handleEmojiSelect(emo)}
                        className="h-9 flex items-center justify-center text-xl rounded-lg hover:bg-white/10 active:scale-125 transition duration-150 cursor-pointer"
                      >
                        {emo}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            {/* Input & Send button row (takes priority on top on mobile) */}
            <div className="flex flex-1 items-center gap-2 order-1 md:order-2 w-full">
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  notifyTyping();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendMessage();
                  }
                }}
                type="text"
                placeholder="Type your message here..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all min-w-0"
              />
              <button
                type="button"
                onClick={sendMessage}
                className="h-11 w-11 shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center transition active:scale-95 shadow-lg shadow-blue-500/20"
              >
                <MdSend size={20} />
              </button>
            </div>

            {/* Utility buttons row (rendered elegantly below input on mobile, left on desktop) */}
            <div className="flex items-center justify-between md:justify-start gap-2 order-2 md:order-1 w-full md:w-auto shrink-0">
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className={`flex-1 md:flex-initial h-11 w-11 border border-white/5 rounded-xl flex items-center justify-center transition active:scale-95 ${
                  showEmojiPicker ? "bg-blue-600 text-white ring-2 ring-blue-400/30 animate-pulse-subtle" : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                }`}
                title="Open Emoji Picker"
              >
                <MdEmojiEmotions size={20} />
              </button>
              <button
                type="button"
                onClick={openCamera}
                className="flex-1 md:flex-initial h-11 w-11 bg-slate-800 hover:bg-slate-700 border border-white/5 text-slate-200 rounded-xl flex items-center justify-center transition active:scale-95"
                title="Open Camera"
              >
                📸
              </button>
              <button
                type="button"
                onClick={startVideoCall}
                className={`flex-1 md:flex-initial h-11 w-11 border border-white/5 rounded-xl flex items-center justify-center transition active:scale-95 ${
                  isVideoCallActive ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                }`}
                title="Start video call"
              >
                📹
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 md:flex-initial h-11 w-11 bg-slate-800 hover:bg-slate-700 border border-white/5 text-slate-200 rounded-xl flex items-center justify-center transition active:scale-95"
                title="Attach file"
              >
                <MdAttachFile size={20} />
              </button>
              <button
                type="button"
                onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                className={`flex-1 md:flex-initial h-11 w-11 border border-white/5 rounded-xl flex items-center justify-center transition active:scale-95 ${
                  isRecording ? "bg-rose-500 text-white animate-pulse" : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                }`}
                title="Voice message"
              >
                🎤
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
