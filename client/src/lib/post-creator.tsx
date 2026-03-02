import { createContext, useContext, useState, type ReactNode } from "react";

interface PostCreatorState {
  isOpen: boolean;
  createdVersion: number;
  openCreator: (reset?: boolean) => void;
  closeCreator: () => void;
  markCreated: () => void;
}

const PostCreatorContext = createContext<PostCreatorState | null>(null);

export function PostCreatorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [createdVersion, setCreatedVersion] = useState(0);

  function openCreator() {
    setIsOpen(true);
  }

  function closeCreator() {
    setIsOpen(false);
  }

  function markCreated() {
    setCreatedVersion((value) => value + 1);
  }

  return (
    <PostCreatorContext.Provider
      value={{ isOpen, createdVersion, openCreator, closeCreator, markCreated }}
    >
      {children}
    </PostCreatorContext.Provider>
  );
}

export function usePostCreator() {
  const context = useContext(PostCreatorContext);
  if (!context) {
    throw new Error("usePostCreator must be used within PostCreatorProvider");
  }
  return context;
}
