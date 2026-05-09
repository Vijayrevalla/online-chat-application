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
      const response = await fetch(fileUrl);
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
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <img
            className="max-h-64 w-full rounded-lg object-cover cursor-pointer hover:opacity-90 transition"
            src={message.fileData}
            alt={message.fileName || "shared image"}
            onClick={() => window.open(message.fileData, "_blank")}
          />
          <button
            onClick={() => handleDownload(message.fileData, message.fileName || "image.jpg")}
            className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
          >
            ⬇️ Download Image
          </button>
        </div>
      );
    }

    if (messageType === "VIDEO" && message.fileData) {
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <video
            className="max-h-64 w-full rounded-lg object-cover"
            controls
            src={message.fileData}
          />
          <button
            onClick={() => handleDownload(message.fileData, message.fileName || "video.mp4")}
            className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
          >
            ⬇️ Download Video
          </button>
        </div>
      );
    }

    if (messageType === "FILE" && message.fileData) {
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <button
            onClick={() => handleDownload(message.fileData, message.fileName || "attachment")}
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
      return (
        <div className="space-y-2">
          {message.content ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : null}
          <audio controls src={message.fileData} className="w-full" />
          <button
            onClick={() => handleDownload(message.fileData, message.fileName || "audio.webm")}
            className="w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition"
          >
            ⬇️ Download Audio
          </button>
        </div>
      );
    }

    return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
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
    <div className="">
      <header className="dark:border-gray-700 fixed w-full dark:bg-gray-900 py-5 shadow flex justify-around items-center">
        <div>
          <h1 className="text-xl font-semibold">
            Room : <span>{roomId}</span>
          </h1>
        </div>

        <div>
          <h1 className="text-xl font-semibold">
            User : <span>{currentUser}</span>
          </h1>
        </div>

        <div>
          <p className="text-sm">
            Status : 
            <span
              className={`font-semibold ${connectionStatus === "CONNECTED" ? "text-green-300" : connectionStatus === "CONNECTING" ? "text-yellow-300" : "text-red-300"}`}
            >
              {connectionStatus}
            </span>
          </p>
          {renderOnlineUsers()}
        </div>

        <div>
          <button
            onClick={handleLogout}
            className="dark:bg-red-500 dark:hover:bg-red-700 px-3 py-2 rounded-full"
          >
            Leave Room
          </button>
        </div>
      </header>

      <video
        ref={cameraCaptureVideoRef}
        style={{ display: "none" }}
        autoPlay
        muted
        playsInline
      />

      <main
        ref={chatBoxRef}
        className="py-20 px-4 md:px-10 w-full md:w-2/3 dark:bg-slate-600 mx-auto h-screen overflow-auto"
      >
        {messages.map((message, index) => (
          <div
            key={`${message.timeStamp || "message"}-${index}`}
            className={`flex ${
              message.sender === currentUser ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`my-2 ${
                message.sender === currentUser ? "bg-green-800" : "bg-gray-800"
              } p-3 max-w-xs md:max-w-md rounded-xl shadow`}
            >
              <div className="flex flex-row gap-3 items-start">
                <div className="h-10 w-10 rounded-full bg-slate-200 text-slate-900 flex items-center justify-center font-bold shrink-0">
                  {getAvatarLabel(message.sender)}
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                  <p className="text-sm font-bold">{message.sender}</p>
                  {renderMessageContent(message)}
                  <p className="text-xs text-gray-400">{timeAgo(message.timeStamp)}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </main>

      {isVideoCallActive ? (
        <div className="fixed top-20 right-4 bg-gray-900/90 rounded-lg p-3 shadow-lg z-50">
          <h2 className="text-sm font-semibold mb-2 text-white">Video Call</h2>
          <div className="flex gap-2">
            <video
              ref={cameraVideoRef}
              autoPlay
              muted
              className="w-32 h-24 bg-black rounded"
            />
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                className="w-32 h-24 bg-black rounded"
              />
            ) : (
              <div className="w-32 h-24 bg-gray-800 rounded flex items-center justify-center text-xs text-white">Waiting for peer</div>
            )}
          </div>
          <button
            onClick={endVideoCall}
            className="mt-2 px-3 py-1 bg-red-600 text-white rounded"
          >
            End Call
          </button>
        </div>
      ) : null}

      {renderTypingIndicator()}

      <div className="fixed bottom-4 w-full px-2 md:px-0">
        <div className="relative pr-3 md:pr-6 gap-3 flex items-center justify-between rounded-2xl w-full md:w-1/2 mx-auto dark:bg-gray-900 min-h-16 py-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar,.csv,.xlsx,.xls"
          />

          <div className="flex-1 px-3 md:px-5">
            {selectedFile ? (
              <div className="mb-2 rounded-lg bg-gray-800 px-3 py-2 text-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-gray-400">{formatFileSize(selectedFile.size)}</p>
                </div>
                <button onClick={clearSelectedFile} type="button">
                  <MdClose size={18} />
                </button>
              </div>
            ) : null}

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
              className="w-full dark:border-gray-600 dark:bg-gray-800 px-5 py-2 rounded-full h-full focus:outline-none"
            />
          </div>

          <div className="flex gap-1 relative">
            <button
              type="button"
              onClick={captureCameraPhoto}
              className="dark:bg-cyan-600 h-10 w-10 flex justify-center items-center rounded-full"
              title="Capture photo"
            >
              📸
            </button>
            <button
              type="button"
              onClick={startVideoCall}
              className={`h-10 w-10 flex justify-center items-center rounded-full ${isVideoCallActive ? "bg-red-600" : "bg-blue-600"}`}
              title="Start video call"
            >
              📹
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="dark:bg-purple-600 h-10 w-10 flex justify-center items-center rounded-full"
              title="Attach file"
            >
              <MdAttachFile size={20} />
            </button>
            <button
              type="button"
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              className={`h-10 w-10 flex justify-center items-center rounded-full ${isRecording ? "bg-red-500" : "bg-yellow-500"}`}
              title="Voice message record"
            >
              🎤
            </button>
            <button
              type="button"
              onClick={sendMessage}
              className="dark:bg-green-600 h-10 w-10 flex justify-center items-center rounded-full"
            >
              <MdSend size={20} />
            </button>

            {showEmojiPicker ? (
              <div className="absolute bottom-14 right-0 rounded-xl bg-gray-800 p-3 shadow-lg grid grid-cols-5 gap-2 z-10">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleEmojiSelect(emoji)}
                    className="text-xl hover:scale-110 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
