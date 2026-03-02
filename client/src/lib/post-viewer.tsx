import { createContext, useContext, useState, type ReactNode } from "react";
import type { Post } from "@shared/schema";

interface PostViewerState {
    viewingPost: Post | null;
    openViewer: (post: Post) => void;
    closeViewer: () => void;
}

const PostViewerContext = createContext<PostViewerState | null>(null);

export function PostViewerProvider({ children }: { children: ReactNode }) {
    const [viewingPost, setViewingPost] = useState<Post | null>(null);

    function openViewer(post: Post) {
        setViewingPost(post);
    }

    function closeViewer() {
        setViewingPost(null);
    }

    return (
        <PostViewerContext.Provider
            value={{ viewingPost, openViewer, closeViewer }}
        >
            {children}
        </PostViewerContext.Provider>
    );
}

export function usePostViewer() {
    const context = useContext(PostViewerContext);
    if (!context) {
        throw new Error("usePostViewer must be used within PostViewerProvider");
    }
    return context;
}
