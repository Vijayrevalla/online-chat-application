package com.substring.chat.controllers;

import com.substring.chat.entities.Message;
import com.substring.chat.entities.Room;
import com.substring.chat.playload.MessageRequest;
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
@CrossOrigin
public class ChatController {


    private final RoomStoreService roomStoreService;

    public ChatController(RoomStoreService roomStoreService) {
        this.roomStoreService = roomStoreService;
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

    private String resolveMessageType(String messageType) {
        if (messageType == null || messageType.isBlank()) {
            return "TEXT";
        }
        return messageType.trim().toUpperCase();
    }
}
