package com.substring.chat.controllers;

import com.substring.chat.entities.Message;
import com.substring.chat.entities.Room;
import com.substring.chat.services.RoomStoreService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/rooms")
@CrossOrigin(originPatterns = "*")

public class RoomController {

    private final RoomStoreService roomStoreService;

    public RoomController(RoomStoreService roomStoreService) {
        this.roomStoreService = roomStoreService;
    }

    //create room
    @PostMapping
    public ResponseEntity<?> createRoom(@RequestBody String roomId) {
        try {
            String normalizedRoomId = roomId == null ? "" : roomId.trim();

            if (normalizedRoomId.isEmpty()) {
                return ResponseEntity.badRequest().body("Room ID is required!");
            }

            if (roomStoreService.existsByRoomId(normalizedRoomId)) {
                return ResponseEntity.badRequest().body("Room already exists!");
            }

            Room room = new Room();
            room.setRoomId(normalizedRoomId);
            Room savedRoom = roomStoreService.save(room);
            return ResponseEntity.status(HttpStatus.CREATED).body(savedRoom);
        } catch (Exception ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body("Database is not available. Please start MySQL and try again.");
        }
    }


    //get room: join
    @GetMapping("/{roomId}")
    public ResponseEntity<?> joinRoom(
            @PathVariable String roomId
    ) {
        try {
            Room room = roomStoreService.findByRoomId(roomId);
            if (room == null) {
                return ResponseEntity.badRequest()
                        .body("Room not found!!");
            }
            return ResponseEntity.ok(room);
        } catch (Exception ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body("Database is not available. Please start MySQL and try again.");
        }
    }


    //get messages of room

    @GetMapping("/{roomId}/messages")
    public ResponseEntity<List<Message>> getMessages(
            @PathVariable String roomId,
            @RequestParam(value = "page", defaultValue = "0", required = false) int page,
            @RequestParam(value = "size", defaultValue = "20", required = false) int size
    ) {
        try {
            Room room = roomStoreService.findByRoomId(roomId);
            if (room == null) {
                return ResponseEntity.badRequest().build();
            }

            List<Message> messages = room.getMessages();
            int start = Math.max(0, messages.size() - (page + 1) * size);
            int end = Math.min(messages.size(), start + size);
            List<Message> paginatedMessages = messages.subList(start, end);
            return ResponseEntity.ok(paginatedMessages);
        } catch (Exception ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }


}
