import { useState } from "react";
import chatIcon from "../assets/chat.png";
import toast from "react-hot-toast";
import { createRoomApi, joinChatApi } from "../services/RoomService";
import useChatContext from "../context/ChatContext";
import { useNavigate } from "react-router";
import { baseURL } from "../config/AxiosHelper";

const JoinCreateChat = () => {
  const [detail, setDetail] = useState({
    roomId: "",
    userName: "",
  });

  const { setRoomId, setCurrentUser, setCurrentUserAvatar, setConnected } = useChatContext();
  const navigate = useNavigate();

  function handleFormInputChange(event) {
    setDetail({
      ...detail,
      [event.target.name]: event.target.value,
    });
  }

  const [avatarPreview, setAvatarPreview] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Avatar image must be smaller than 5MB");
      return;
    }

    setAvatarPreview(URL.createObjectURL(file));
    setUploadingAvatar(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${baseURL}/upload`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error("Failed to upload profile picture");
      }
      const data = await response.json();
      setCurrentUserAvatar(data.url);
      toast.success("Profile picture uploaded successfully!");
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error("Could not upload profile photo.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  function validateForm() {
    if (detail.roomId === "" || detail.userName === "") {
      toast.error("Invalid Input !!");
      return false;
    }
    return true;
  }

  async function joinChat() {
    if (validateForm()) {
      //join chat

      try {
        const room = await joinChatApi(detail.roomId);
        toast.success("joined..");
        setCurrentUser(detail.userName);
        setRoomId(room.roomId);
        setConnected(true);
        navigate("/chat");
      } catch (error) {
        if (error.response?.status === 400) {
          toast.error(error.response.data);
        } else if (error.response?.status === 503) {
          toast.error("Database is not available. Start MySQL and try again.");
        } else {
          toast.error(error.response?.data || "Error in joining room");
        }
        console.log(error);
      }
    }
  }

  async function createRoom() {
    if (validateForm()) {
      //create room
      console.log(detail);
      // call api to create room on backend
      try {
        const response = await createRoomApi(detail.roomId);
        console.log(response);
        toast.success("Room Created Successfully !!");
        //join the room
        setCurrentUser(detail.userName);
        setRoomId(response.roomId);
        setConnected(true);

        navigate("/chat");

        //forward to chat page...
      } catch (error) {
        console.log(error);
        if (error.response?.status === 400) {
          toast.error("Room already exists !!");
        } else if (error.response?.status === 503) {
          toast.error("Database is not available. Start MySQL and try again.");
        } else {
          toast.error(error.response?.data || "Error in creating room");
        }
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-900 via-slate-900 to-blue-900 p-4 md:p-6 animate-fade-in">
      {/* Background blobs for depth */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-2xl opacity-20 animate-pulse-slow"></div>
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-2xl opacity-20 animate-pulse-slow"></div>

      <div className="relative p-6 md:p-10 w-full flex flex-col gap-6 max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl animate-slide-up">
        <div className="animate-float">
          <img src={chatIcon} className="w-20 md:w-24 mx-auto drop-shadow-xl" alt="Chat Logo" />
        </div>

        <div className="text-center space-y-1">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
            VibeChat
          </h1>
          <p className="text-sm text-slate-400">Connect securely with your squad instantly</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Profile Avatar Picker */}
          <div className="flex flex-col items-center justify-center mb-2 group">
            <div className="relative h-20 w-20 rounded-full overflow-hidden border-2 border-dashed border-slate-700 hover:border-blue-500 bg-white/5 transition-all cursor-pointer shadow-2xl flex items-center justify-center">
              {avatarPreview ? (
                <img src={avatarPreview} className="h-full w-full object-cover" alt="Avatar Preview" />
              ) : (
                <div className="flex flex-col items-center justify-center p-2 text-slate-400">
                  <span className="text-2xl mb-0.5">👤</span>
                  <span className="text-[8px] font-bold uppercase tracking-widest">Add Photo</span>
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                disabled={uploadingAvatar}
              />
              {uploadingAvatar && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-[10px] font-bold text-blue-400">
                  ...
                </div>
              )}
            </div>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-2 transition group-hover:text-slate-300">
              {uploadingAvatar ? "Uploading Photo..." : "Set Profile Picture"}
            </span>
          </div>

          {/* name div */}
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Your name
            </label>
            <input
              onChange={handleFormInputChange}
              value={detail.userName}
              type="text"
              id="name"
              name="userName"
              placeholder="e.g. John Doe"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-sm md:text-base"
            />
          </div>

          {/* room id div */}
          <div className="space-y-1.5">
            <label htmlFor="roomId" className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Room ID / New Room ID
            </label>
            <input
              name="roomId"
              onChange={handleFormInputChange}
              value={detail.roomId}
              type="text"
              id="roomId"
              placeholder="e.g. general-room"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-sm md:text-base"
            />
          </div>
        </div>

        {/* buttons */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            onClick={joinChat}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-blue-500/20 active:scale-95 transition-all duration-300 text-sm md:text-base"
          >
            Join Room
          </button>
          <button
            onClick={createRoom}
            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-emerald-500/20 active:scale-95 transition-all duration-300 text-sm md:text-base"
          >
            Create Room
          </button>
        </div>
      </div>
    </div>
  );
};

export default JoinCreateChat;
