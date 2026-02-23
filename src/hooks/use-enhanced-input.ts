import { useState, useCallback, useRef } from "react";
import {
  deleteCharBefore,
  deleteCharAfter,
  deleteWordBefore,
  deleteWordAfter,
  insertText,
  moveToLineStart,
  moveToLineEnd,
  moveToPreviousWord,
  moveToNextWord,
} from "../utils/text-utils.js";
import { useInputHistory } from "./use-input-history.js";

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  paste?: boolean;
  sequence?: string;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

export interface EnhancedInputHook {
  input: string;
  cursorPosition: number;
  isMultiline: boolean;
  setInput: (text: string) => void;
  setCursorPosition: (position: number) => void;
  setInputAndCursor: (text: string, position: number) => void;
  clearInput: () => void;
  insertAtCursor: (text: string) => void;
  resetHistory: () => void;
  handleInput: (inputChar: string, key: Key) => void;
}

interface UseEnhancedInputProps {
  onSubmit?: (text: string) => void;
  onEscape?: () => void;
  onSpecialKey?: (key: Key) => boolean; // Return true to prevent default handling
  disabled?: boolean;
  multiline?: boolean;
}

export function useEnhancedInput({
  onSubmit,
  onEscape,
  onSpecialKey,
  disabled = false,
  multiline = false,
}: UseEnhancedInputProps = {}): EnhancedInputHook {
  const [input, setInputState] = useState("");
  const [cursorPosition, setCursorPositionState] = useState(0);
  const isMultilineRef = useRef(multiline);
  
  const {
    addToHistory,
    navigateHistory,
    resetHistory,
    setOriginalInput,
    isNavigatingHistory,
  } = useInputHistory();

  const setInput = useCallback((text: string) => {
    setInputState(text);
    setCursorPositionState(Math.min(text.length, cursorPosition));
    if (!isNavigatingHistory()) {
      setOriginalInput(text);
    }
  }, [cursorPosition, isNavigatingHistory, setOriginalInput]);

  const setCursorPosition = useCallback((position: number) => {
    setCursorPositionState(Math.max(0, Math.min(input.length, position)));
  }, [input.length]);

  const setInputAndCursor = useCallback((text: string, position: number) => {
    setInputState(text);
    setCursorPositionState(Math.max(0, Math.min(text.length, position)));
    if (!isNavigatingHistory()) {
      setOriginalInput(text);
    }
  }, [isNavigatingHistory, setOriginalInput]);

  const clearInput = useCallback(() => {
    setInputState("");
    setCursorPositionState(0);
    setOriginalInput("");
  }, [setOriginalInput]);

  const insertAtCursor = useCallback((text: string) => {
    const result = insertText(input, cursorPosition, text);
    setInputState(result.text);
    setCursorPositionState(result.position);
    setOriginalInput(result.text);
  }, [input, cursorPosition, setOriginalInput]);

  const handleSubmit = useCallback(() => {
    if (input.trim()) {
      addToHistory(input);
      onSubmit?.(input);
      clearInput();
    }
  }, [input, addToHistory, onSubmit, clearInput]);

  const handleInput = useCallback((inputChar: string, key: Key) => {
    if (disabled) return;

    // Handle Ctrl+C - check multiple ways it could be detected
    if ((key.ctrl && inputChar === "c") || inputChar === "\x03") {
      setInputState("");
      setCursorPositionState(0);
      setOriginalInput("");
      return;
    }

    // Allow special key handler to override default behavior
    if (onSpecialKey?.(key)) {
      return;
    }

    // Handle Enter/Return - be robust about key detection based on diagnostic logs
    // Shift+Enter sometimes sends "\\\r" with no modifier flags
    // Option+Enter sometimes sends "\r" with key.return: false
    const isShiftEnterSequence = inputChar === "\\\r" || inputChar === "\\\n" || key.sequence === "\x1b[13;2u" || key.sequence === "\x1b[10;2u";
    const isOptionEnterSequence = (inputChar === "\r" && !key.return) || key.sequence === "\x1b\r" || key.sequence === "\x1b\n";
    const isStandardReturn = key.return || inputChar === "\r" || inputChar === "\n";
    
    const isReturnKey = isStandardReturn || isShiftEnterSequence || isOptionEnterSequence;

    if (isReturnKey) {
      // In multiline mode, Shift/Option+Enter OR the special sequences we found in the logs
      // should trigger a newline. 
      const forceNewline = isShiftEnterSequence || isOptionEnterSequence || key.shift || key.meta;
      
      // Look back for a backslash immediately before the cursor (manual line continuation)
      const charBeforeCursor = cursorPosition > 0 ? input[cursorPosition - 1] : "";
      const isBackslashContinuation = charBeforeCursor === "\\";

      if (multiline && (forceNewline || isBackslashContinuation)) {
        // If it was a manual backslash followed by a standard Enter, remove the backslash
        if (isBackslashContinuation && !forceNewline) {
          const textWithoutBackslash = input.slice(0, cursorPosition - 1) + input.slice(cursorPosition);
          const result = insertText(textWithoutBackslash, cursorPosition - 1, "\n");
          setInputState(result.text);
          setCursorPositionState(result.position);
          setOriginalInput(result.text);
        } else {
          // It's a detected Shift/Option sequence or a meta/shift key
          const result = insertText(input, cursorPosition, "\n");
          setInputState(result.text);
          setCursorPositionState(result.position);
          setOriginalInput(result.text);
        }
      } else {
        handleSubmit();
      }
      return;
    }

    // Handle Escape - checked AFTER potential Return combo
    if (key.escape) {
      onEscape?.();
      return;
    }

    // Handle history navigation
    if ((key.upArrow || key.name === 'up') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("up");
      if (historyInput !== null) {
        setInputState(historyInput);
        setCursorPositionState(historyInput.length);
      }
      return;
    }

    if ((key.downArrow || key.name === 'down') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("down");
      if (historyInput !== null) {
        setInputState(historyInput);
        setCursorPositionState(historyInput.length);
      }
      return;
    }

    // Handle cursor movement - ignore meta flag for arrows as it's unreliable in terminals
    // Only do word movement if ctrl is pressed AND no arrow escape sequence is in inputChar
    if ((key.leftArrow || key.name === 'left') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToPreviousWord(input, cursorPosition);
      setCursorPositionState(newPos);
      return;
    }

    if ((key.rightArrow || key.name === 'right') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToNextWord(input, cursorPosition);
      setCursorPositionState(newPos);
      return;
    }

    // Handle regular cursor movement - single character (ignore meta flag)
    if (key.leftArrow || key.name === 'left') {
      const newPos = Math.max(0, cursorPosition - 1);
      setCursorPositionState(newPos);
      return;
    }

    if (key.rightArrow || key.name === 'right') {
      const newPos = Math.min(input.length, cursorPosition + 1);
      setCursorPositionState(newPos);
      return;
    }

    // Handle Home/End keys or Ctrl+A/E
    if ((key.ctrl && inputChar === "a") || key.name === "home") {
      setCursorPositionState(0); // Simple start of input
      return;
    }

    if ((key.ctrl && inputChar === "e") || key.name === "end") {
      setCursorPositionState(input.length); // Simple end of input
      return;
    }

    // Handle deletion - check multiple ways backspace might be detected
    // Backspace can be detected in different ways depending on terminal
    // In some terminals, backspace shows up as delete:true with empty inputChar
    const isBackspace = key.backspace || 
                       key.name === 'backspace' || 
                       inputChar === '\b' || 
                       inputChar === '\x7f' ||
                       (key.delete && inputChar === '' && !key.shift);
                       
    if (isBackspace) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Backspace: Delete word before cursor
        const result = deleteWordBefore(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        // Regular backspace
        const result = deleteCharBefore(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      }
      return;
    }

    // Handle forward delete (Del key) - but not if it was already handled as backspace above
    if ((key.delete && inputChar !== '') || (key.ctrl && inputChar === "d")) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Delete: Delete word after cursor
        const result = deleteWordAfter(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        // Regular delete
        const result = deleteCharAfter(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      }
      return;
    }

    // Handle Ctrl+K: Delete from cursor to end of line
    if (key.ctrl && inputChar === "k") {
      const lineEnd = moveToLineEnd(input, cursorPosition);
      const newText = input.slice(0, cursorPosition) + input.slice(lineEnd);
      setInputState(newText);
      setOriginalInput(newText);
      return;
    }

    // Handle Ctrl+U: Delete from cursor to start of line
    if (key.ctrl && inputChar === "u") {
      const lineStart = moveToLineStart(input, cursorPosition);
      const newText = input.slice(0, lineStart) + input.slice(cursorPosition);
      setInputState(newText);
      setCursorPositionState(lineStart);
      setOriginalInput(newText);
      return;
    }

    // Handle Ctrl+W: Delete word before cursor
    if (key.ctrl && inputChar === "w") {
      const result = deleteWordBefore(input, cursorPosition);
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
      return;
    }

    // Handle Ctrl+X: Clear entire input
    if (key.ctrl && inputChar === "x") {
      setInputState("");
      setCursorPositionState(0);
      setOriginalInput("");
      return;
    }

    // Handle regular character input
    if (inputChar && !key.ctrl && !key.meta) {
      // Strip carriage returns as they corrupt Ink's ANSI terminal tracking
      const cleanChar = inputChar.replace(/\r/g, "");
      const result = insertText(input, cursorPosition, cleanChar);
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
    }
  }, [disabled, onSpecialKey, input, cursorPosition, multiline, handleSubmit, navigateHistory, setOriginalInput]);

  return {
    input,
    cursorPosition,
    isMultiline: isMultilineRef.current,
    setInput,
    setCursorPosition,
    setInputAndCursor,
    clearInput,
    insertAtCursor,
    resetHistory,
    handleInput,
  };
}