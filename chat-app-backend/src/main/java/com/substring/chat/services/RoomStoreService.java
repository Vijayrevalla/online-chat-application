package com.substring.chat.services;

import com.substring.chat.entities.Message;
import com.substring.chat.entities.Room;
import com.substring.chat.repositories.RoomRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class RoomStoreService {

    private final RoomRepository roomRepository;

    public RoomStoreService(RoomRepository roomRepository) {
        this.roomRepository = roomRepository;
    }

    @Transactional(readOnly = true)
    public Room findByRoomId(String roomId) {
        return roomRepository.findByRoomId(roomId).orElse(null);
    }

    @Transactional(readOnly = true)
    public boolean existsByRoomId(String roomId) {
        return roomRepository.existsByRoomId(roomId);
    }

    public Room save(Room room) {
        if (room.getRoomId() == null || room.getRoomId().isBlank()) {
            throw new IllegalArgumentException("Room ID is required!");
        }

        if (room.getMessages() != null) {
            for (Message message : room.getMessages()) {
                message.setRoom(room);
            }
        }

        return roomRepository.save(room);
    }
}
