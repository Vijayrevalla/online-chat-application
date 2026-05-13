package com.substring.chat.controllers;

import com.substring.chat.entities.Message;
import com.substring.chat.entities.Room;
import com.substring.chat.playload.MessageRequest;
import com.substring.chat.repositories.MessageRepository;
import com.substring.chat.repositories.RoomRepository;
import com.substring.chat.services.RoomStoreService;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChatControllerTests {

    @Test
    void sendMessageCopiesAttachmentMetadata() {
        RoomRepository roomRepository = mock(RoomRepository.class);
        MessageRepository messageRepository = mock(MessageRepository.class);
        RoomStoreService roomStoreService = new RoomStoreService(roomRepository);
        ChatController chatController = new ChatController(roomStoreService, messageRepository);

        Room room = new Room();
        room.setRoomId("room1");

        when(roomRepository.findByRoomId("room1")).thenReturn(Optional.of(room));
        when(roomRepository.save(any(Room.class))).thenReturn(room);

        MessageRequest request = new MessageRequest();
        request.setRoomId("room1");
        request.setSender("alpha");
        request.setContent("See this image");
        request.setMessageType("IMAGE");
        request.setFileName("picture.png");
        request.setFileType("image/png");
        request.setFileData("data:image/png;base64,abc123");

        Message message = chatController.sendMessage("room1", request);

        assertThat(message.getSender()).isEqualTo("alpha");
        assertThat(message.getMessageType()).isEqualTo("IMAGE");
        assertThat(message.getFileName()).isEqualTo("picture.png");
        assertThat(message.getFileType()).isEqualTo("image/png");
        assertThat(message.getFileData()).startsWith("data:image/png;base64,");
        assertThat(room.getMessages()).hasSize(1);
        verify(roomRepository).save(room);
    }
}
