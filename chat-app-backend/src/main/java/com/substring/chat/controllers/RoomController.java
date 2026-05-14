package com.substring.chat.controllers;

import com.substring.chat.entities.Message;
import com.substring.chat.entities.Room;
import com.substring.chat.services.RoomStoreService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.net.InetAddress;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

    // clear messages of room
    @DeleteMapping("/{roomId}/messages")
    public ResponseEntity<?> clearChat(@PathVariable String roomId) {
        try {
            Room room = roomStoreService.findByRoomId(roomId);
            if (room == null) {
                return ResponseEntity.notFound().build();
            }
            
            // Clearing the list triggers Hibernate orphanRemoval=true 
            // to delete rows from the DB automatically!
            room.getMessages().clear();
            roomStoreService.save(room);
            
            return ResponseEntity.ok().build();
        } catch (Exception ex) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body("Error while clearing database chat logs.");
        }
    }

    // Proxied Dynamic Ice Servers with IP Resolution to bypass ISP-level domain blocks!
    @GetMapping("/ice-servers")
    public ResponseEntity<?> getIceServers() {
        try {
            RestTemplate restTemplate = new RestTemplate();
            String url = "https://openrelay.metered.ca/api/v1/turn/credentials";
            
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> response = restTemplate.getForObject(url, List.class);
            if (response == null || response.isEmpty()) {
                return ResponseEntity.ok(fallbackStunServers());
            }

            // Perform Backend DNS Lookup to resolve domain to raw IPv4
            String resolvedIp = "openrelay.metered.ca";
            try {
                InetAddress[] addresses = InetAddress.getAllByName("openrelay.metered.ca");
                if (addresses != null && addresses.length > 0) {
                    resolvedIp = addresses[0].getHostAddress();
                }
            } catch (Exception e) {
                System.err.println("Failed to resolve Metered IP, fallback to domain: " + e.getMessage());
            }

            // Rewrite URLs in the ICE Servers block to replace the domain with raw IP
            for (Map<String, Object> server : response) {
                Object urlsObj = server.get("urls");
                if (urlsObj instanceof String) {
                    String modified = ((String) urlsObj).replace("openrelay.metered.ca", resolvedIp);
                    server.put("urls", modified);
                } else if (urlsObj instanceof List) {
                    @SuppressWarnings("unchecked")
                    List<String> urlsList = (List<String>) urlsObj;
                    List<String> modifiedList = new ArrayList<>();
                    for (String u : urlsList) {
                        modifiedList.add(u.replace("openrelay.metered.ca", resolvedIp));
                    }
                    server.put("urls", modifiedList);
                }
            }
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            System.err.println("Proxying TURN servers failed: " + e.getMessage());
            return ResponseEntity.ok(fallbackStunServers());
        }
    }

    private List<Map<String, Object>> fallbackStunServers() {
        List<Map<String, Object>> fallback = new ArrayList<>();
        
        Map<String, Object> s1 = new HashMap<>();
        s1.put("urls", "stun:stun.l.google.com:19302");
        fallback.add(s1);
        
        Map<String, Object> s2 = new HashMap<>();
        s2.put("urls", "stun:stun1.l.google.com:3478");
        fallback.add(s2);
        
        return fallback;
    }

}
