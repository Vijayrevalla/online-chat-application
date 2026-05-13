package com.substring.chat.controllers;

import com.substring.chat.entities.Message;
import com.substring.chat.entities.Room;
import com.substring.chat.playload.MessageRequest;
import com.substring.chat.repositories.MessageRepository;
import com.substring.chat.services.RoomStoreService;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.RequestBody;

import java.time.LocalDateTime;
import java.util.Map;

@Controller
@CrossOrigin(originPatterns = "*")
public class ChatController {


    private final RoomStoreService roomStoreService;
    private final MessageRepository messageRepository;

    public ChatController(RoomStoreService roomStoreService, MessageRepository messageRepository) {
        this.roomStoreService = roomStoreService;
        this.messageRepository = messageRepository;
    }


    @MessageMapping("/sendMessage/{roomId}")
    @SendTo("/topic/room/{roomId}")
    public Message sendMessage(
            @DestinationVariable String roomId,
            @RequestBody MessageRequest request
    ) {

        String targetRoomId = request.getRoomId() == null || request.getRoomId().isBlank()
                ? roomId
                : request.getRoomId();

        Room room = roomStoreService.findByRoomId(targetRoomId);
        if (room == null) {
            throw new RuntimeException("room not found !!");
        }

        if ((request.getContent() == null || request.getContent().isBlank())
                && (request.getFileData() == null || request.getFileData().isBlank())) {
            throw new IllegalArgumentException("Message content or attachment is required");
        }

        Message message = new Message();
        message.setContent(request.getContent());
        message.setSender(request.getSender());
        message.setTimeStamp(LocalDateTime.now());
        message.setMessageType(resolveMessageType(request.getMessageType()));
        message.setFileName(request.getFileName());
        message.setFileType(request.getFileType());
        message.setFileData(request.getFileData());
        message.setSenderAvatar(request.getSenderAvatar());

        room.addMessage(message);
        roomStoreService.save(room);

        return message;
    }

    @MessageMapping("/userPresence/{roomId}")
    @SendTo("/topic/room/{roomId}")
    public Map<String, Object> userPresence(
            @DestinationVariable String roomId,
            @RequestBody Map<String, Object> payload
    ) {
        // echo presence to subscribers
        return payload;
    }

    @MessageMapping("/typing/{roomId}")
    @SendTo("/topic/room/{roomId}/typing")
    public String typing(
            @DestinationVariable String roomId,
            @RequestBody String username
    ) {
        return username;
    }

    @MessageMapping("/call/{roomId}")
    @SendTo("/topic/room/{roomId}")
    public Map<String, Object> callSignal(
            @DestinationVariable String roomId,
            @RequestBody Map<String, Object> signal
    ) {
        return signal;
    }

    @MessageMapping("/deleteMessage/{roomId}")
    @SendTo("/topic/room/{roomId}")
    public Message deleteMessage(
            @DestinationVariable String roomId,
            @RequestBody Map<String, Object> payload
    ) {
        if (payload.get("messageId") == null) {
            return null;
        }
        try {
            Long messageId = Long.valueOf(payload.get("messageId").toString());
            Message message = messageRepository.findById(messageId).orElse(null);
            if (message != null) {
                message.setIsDeleted(true);
                message.setMessageType("DELETE");
                message.setContent("🚫 This message was deleted");
                message.setFileData(null);
                message.setFileName(null);
                message.setFileType(null);
                return messageRepository.save(message);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }

    @MessageMapping("/clearChat/{roomId}")
    @SendTo("/topic/room/{roomId}")
    public Map<String, Object> clearChatSignal(
            @DestinationVariable String roomId,
            @RequestBody Map<String, Object> payload
    ) {
        // echoes CLEAR_CHAT broadcast back to all room occupants
        return payload;
    }

    private String resolveMessageType(String messageType) {
        if (messageType == null || messageType.isBlank()) {
            return "TEXT";
        }
        return messageType.trim().toUpperCase();
    }
}
