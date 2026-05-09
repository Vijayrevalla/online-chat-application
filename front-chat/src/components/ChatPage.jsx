import { useEffect, useRef, useState } from "react";
import { MdAttachFile, MdClose, MdEmojiEmotions, MdSend } from "react-icons/md";
import useChatContext from "../context/ChatContext";
import { useNavigate } from "react-router";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";
import toast from "react-hot-toast";
import { baseURL } from "../config/AxiosHelper";
import { getMessagess } from "../services/RoomService";
import { timeAgo } from "../config/helper";

const EMOJI_OPTIONS = ["😀", "😂", "😍", "😎", "🤝", "👍", "🎉", "🔥", "❤️", "🙏"];
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
  const [callPeerConnection, setCallPeerConnection] = useState(null);
  const cameraVideoRef = useRef(null);
  const cameraCaptureVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const cameraCaptureStreamRef = useRef(null);
  const pendingCallSignalRef = useRef(null);
  const chatBoxRef = useRef(null);
  const fileInputRef = useRef(null);
  const stompSubscriptionRef = useRef(null);
  const typingTimeoutRef = useRef(null);

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
    return (
      stompClient &&
      (stompClient.active || stompClient.connected || isStompConnected)
    );
  };

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!isStompReady() || !pendingCallSignalRef.current) {
      return;
    }

    const signal = pendingCallSignalRef.current;
    pendingCallSignalRef.current = null;

    try {
      stompClient.publish({
        destination: `/app/call/${roomId}`,
        body: JSON.stringify(signal),
      });
      toast.success("Pending call signal sent after reconnect.");
    } catch (err) {
      console.error("Failed to send pending call signal", err);
      toast.error("Failed to send pending call signal after reconnect.");
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
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
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
            setOnlineUsers((prev) => (prev.includes(newMessage.user) ? prev : [...prev, newMessage.user]));
            return;
          }

          if (newMessage.type === "LEAVE") {
            setOnlineUsers((prev) => prev.filter((user) => user !== newMessage.user));
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

        // broadcast presence
        client.publish({
          destination: `/app/userPresence/${roomId}`,
          body: JSON.stringify({ user: currentUser, type: "JOIN" }),
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
    };

    try {
      stompClient.publish({
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

  const notifyTyping = () => {
    if (!isStompReady()) {
      return;
    }

    stompClient.publish({
      destination: `/app/typing/${roomId}`,
      body: currentUser,
    });
  };

  const sendCallSignal = (signal) => {
    if (!signal) return;

    if (!isStompReady()) {
      pendingCallSignalRef.current = signal;
      toast.loading("STOMP disconnected. Call response will be sent when connected.");
      return;
    }

    try {
      stompClient.publish({
        destination: `/app/call/${roomId}`,
        body: JSON.stringify(signal),
      });
    } catch (err) {
      console.error("Unable to publish call signal", err);
      toast.error("Unable to publish call signal.");
      pendingCallSignalRef.current = signal;
    }
  };

  const processIncomingCallSignal = async (signal) => {
    if (!signal || !signal.type) return;

    if (signal.type === "OFFER") {
      await initiateCallReception(signal);
      return;
    }

    if (signal.type === "ANSWER") {
      if (callPeerConnection && signal.sdp) {
        await callPeerConnection.setRemoteDescription(signal.sdp);
      }
      return;
    }

    if (signal.type === "ICE") {
      if (callPeerConnection && signal.candidate) {
        try {
          await callPeerConnection.addIceCandidate(signal.candidate);
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

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ontrack = (event) => {
      const remote = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      setRemoteStream(remote);
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

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = stream;
      cameraVideoRef.current.muted = true;
      await cameraVideoRef.current.play();
    }
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    setLocalStream(stream);

    await pc.setRemoteDescription(signal.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    setCallPeerConnection(pc);
    setIsVideoCallActive(true);

    sendCallSignal({ type: "ANSWER", sdp: pc.localDescription, from: currentUser });
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

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = stream;
      cameraVideoRef.current.muted = true;
      await cameraVideoRef.current.play();
    }
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      const remote = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
      setRemoteStream(remote);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        stompClient.publish({
          destination: `/app/call/${roomId}`,
          body: JSON.stringify({
            type: "ICE",
            candidate: event.candidate,
            from: currentUser,
          }),
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendCallSignal({ type: "OFFER", sdp: pc.localDescription, from: currentUser });

    setLocalStream(stream);
    setCallPeerConnection(pc);
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

    if (callPeerConnection) {
      callPeerConnection.close();
      setCallPeerConnection(null);
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
    if (stompClient?.active) {
      stompClient.publish({
        destination: `/app/userPresence/${roomId}`,
        body: JSON.stringify({ user: currentUser, type: "LEAVE" }),
      });
      stompClient.deactivate();
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

        <button
          onClick={handleLogout}
          className="w-full md:w-auto px-4 py-2 bg-rose-500/10 hover:bg-rose-600 border border-rose-500/20 hover:border-transparent text-rose-200 hover:text-white rounded-xl text-sm font-semibold transition-all duration-300 active:scale-95"
        >
          Leave Room
        </button>
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
              <div className="h-9 w-9 rounded-full bg-slate-800 text-slate-200 border border-white/10 flex items-center justify-center font-bold text-sm shrink-0">
                {getAvatarLabel(message.sender)}
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-xs font-semibold text-blue-300">{message.sender}</span>
                <div className="text-sm leading-relaxed">{renderMessageContent(message)}</div>
                <span className="text-[10px] text-slate-400 mt-1 self-end">{timeAgo(message.timeStamp)}</span>
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
              muted
              className="w-24 h-18 bg-black rounded-lg border border-white/5"
            />
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
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
