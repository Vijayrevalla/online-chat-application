package com.substring.chat.entities;

import com.fasterxml.jackson.annotation.JsonManagedReference;
import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "rooms")
public class Room {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String roomId;

    @OneToMany(mappedBy = "room", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("timeStamp ASC")
    @JsonManagedReference
    private List<Message> messages = new ArrayList<>();

    public Room() {
    }

    public Room(Long id, String roomId, List<Message> messages) {
        this.id = id;
        this.roomId = roomId;
        setMessages(messages);
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public List<Message> getMessages() {
        return messages;
    }

    public void setMessages(List<Message> messages) {
        this.messages.clear();
        if (messages != null) {
            messages.forEach(this::addMessage);
        }
    }

    public void addMessage(Message message) {
        if (message != null) {
            message.setRoom(this);
            this.messages.add(message);
        }
    }
}
