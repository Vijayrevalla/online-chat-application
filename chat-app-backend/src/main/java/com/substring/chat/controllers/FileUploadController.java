package com.substring.chat.controllers;

import com.substring.chat.entities.FileAttachment;
import com.substring.chat.repositories.FileAttachmentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import jakarta.servlet.http.HttpServletRequest;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@RestController
@CrossOrigin(originPatterns = "*")
@RequestMapping("/upload")
public class FileUploadController {

    private final FileAttachmentRepository fileAttachmentRepository;

    public FileUploadController(FileAttachmentRepository fileAttachmentRepository) {
        this.fileAttachmentRepository = fileAttachmentRepository;
    }

    @PostMapping
    public ResponseEntity<Map<String, String>> uploadFile(@RequestParam("file") MultipartFile file, HttpServletRequest request) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
        }

        if (file.getSize() > 50L * 1024L * 1024L) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(Map.of("error", "File too large (max 50 MB)"));
        }

        try {
            String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "file";
            String contentType = file.getContentType() != null ? file.getContentType() : "application/octet-stream";
            byte[] bytes = file.getBytes();

            FileAttachment attachment = new FileAttachment(originalName, contentType, bytes);
            FileAttachment saved = fileAttachmentRepository.save(attachment);

            // Dynamically build the file URL pointing to our new DB serving endpoint
            String scheme = request.getScheme();
            String serverName = request.getServerName();
            int port = request.getServerPort();
            String fileUrl;
            
            if (serverName != null && serverName.contains("onrender.com")) {
                fileUrl = String.format("https://%s/upload/files/%s", serverName, saved.getId());
            } else {
                fileUrl = String.format("%s://%s:%d/upload/files/%s", scheme, serverName, port, saved.getId());
            }
            
            Map<String, String> response = new HashMap<>();
            response.put("url", fileUrl);
            return ResponseEntity.ok(response);
        } catch (IOException ex) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to save file"));
        }
    }

    @GetMapping("/files/{id}")
    public ResponseEntity<byte[]> getFile(@PathVariable String id) {
        return fileAttachmentRepository.findById(id)
                .map(file -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(file.getFileType()))
                        .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + file.getFileName() + "\"")
                        .body(file.getData()))
                .orElse(ResponseEntity.notFound().build());
    }
}
