package com.substring.chat.repositories;

import com.substring.chat.entities.Room;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RoomRepository extends JpaRepository<Room, Long> {
    Optional<Room> findByRoomId(String roomId);

    boolean existsByRoomId(String roomId);
}
