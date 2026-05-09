package com.substring.chat.services;

import com.substring.chat.entities.Room;
import com.substring.chat.repositories.RoomRepository;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoomStoreServiceTests {

    @Test
    void saveDelegatesToRepository() {
        RoomRepository roomRepository = mock(RoomRepository.class);
        RoomStoreService roomStoreService = new RoomStoreService(roomRepository);

        Room room = new Room();
        room.setRoomId("room1");

        when(roomRepository.save(room)).thenReturn(room);

        Room savedRoom = roomStoreService.save(room);

        assertThat(savedRoom).isSameAs(room);
        verify(roomRepository).save(room);
    }

    @Test
    void findByRoomIdUsesRepositoryWhenAvailable() {
        RoomRepository roomRepository = mock(RoomRepository.class);
        RoomStoreService roomStoreService = new RoomStoreService(roomRepository);

        Room room = new Room();
        room.setRoomId("room2");

        when(roomRepository.findByRoomId("room2")).thenReturn(Optional.of(room));

        Room foundRoom = roomStoreService.findByRoomId("room2");

        assertThat(foundRoom).isSameAs(room);
    }
}
