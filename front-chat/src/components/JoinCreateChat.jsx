import { useState } from "react";
import chatIcon from "../assets/chat.png";
import toast from "react-hot-toast";
import { createRoomApi, joinChatApi } from "../services/RoomService";
import useChatContext from "../context/ChatContext";
import { useNavigate } from "react-router";
const JoinCreateChat = () => {
  const [detail, setDetail] = useState({
    roomId: "",
    userName: "",
  });

  const { setRoomId, setCurrentUser, setConnected } = useChatContext();
  const navigate = useNavigate();

  function handleFormInputChange(event) {
    setDetail({
      ...detail,
      [event.target.name]: event.target.value,
    });
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
