import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { AnalysisResult } from '../types';

// FIX: Initialize GoogleGenAI with API_KEY from environment variables.
// In Vite, we use define in vite.config.ts to expose these to the client.
const apiKey = (typeof process !== 'undefined' && process.env.API_KEY) || import.meta.env.VITE_GEMINI_API_KEY || '';

if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Please set it in your environment variables.");
}

const ai = new GoogleGenAI({ apiKey });

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        originalText: {
            type: Type.ARRAY,
            description: '이미지에서 추출된 한국어 텍스트 원문. 제목과 문단을 구분하여 구조화된 배열로 제공해야 합니다. 각 항목은 type("title" 또는 "paragraph")과 content(텍스트)를 포함해야 합니다.',
            items: {
                type: Type.OBJECT,
                properties: {
                    type: {
                        type: Type.STRING,
                        description: '텍스트 블록의 유형. "title" 또는 "paragraph"가 될 수 있습니다.'
                    },
                    content: {
                        type: Type.STRING,
                        description: '실제 텍스트 내용. 한 글자도 틀리지 않고 정확해야 합니다.'
                    }
                },
                required: ['type', 'content']
            }
        },
        vocabularyAnalysis: {
            type: Type.ARRAY,
            description: '각 문장에 대한 주요 어휘 및 문법 분석.',
            items: {
                type: Type.OBJECT,
                properties: {
                    sentence: {
                        type: Type.STRING,
                        description: '분석 대상이 되는 한국어 문장.'
                    },
                    keywords: {
                        type: Type.ARRAY,
                        description: '문장에서 학습해야 할 주요 단어 또는 문법 목록.',
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                korean: { type: Type.STRING, description: '한국어 단어 또는 표현.' },
                                japanese: { type: Type.STRING, description: '일본어 번역 또는 대응 표현.' },
                                explanation: { type: Type.STRING, description: '해당 단어 또는 표현에 대한 간략한 일본어 설명.' }
                            },
                            required: ['korean', 'japanese', 'explanation']
                        }
                    }
                },
                required: ['sentence', 'keywords']
            }
        },
        japaneseTranslation: {
            type: Type.ARRAY,
            description: '전체 텍스트에 대한 자연스러운 일본어 번역문. 원문과 동일하게 제목과 문단을 구분하여 구조화된 배열로 제공해야 합니다.',
            items: {
                type: Type.OBJECT,
                properties: {
                    type: {
                        type: Type.STRING,
                        description: '텍스트 블록의 유형. "title" 또는 "paragraph"가 될 수 있습니다.'
                    },
                    content: {
                        type: Type.STRING,
                        description: '번역된 텍스트 내용.'
                    }
                },
                required: ['type', 'content']
            }
        }
    },
    required: ['originalText', 'vocabularyAnalysis', 'japaneseTranslation']
};


export const analyzeKoreanImage = async (base64ImageData: string, mimeType: string): Promise<AnalysisResult> => {
    const model = 'gemini-2.5-flash';

    const imagePart = {
        inlineData: {
            data: base64ImageData,
            mimeType: mimeType,
        },
    };

    const textPart = {
        text: `You are an expert Korean language teacher for Japanese learners. Your task is to analyze the provided image containing Korean text. Your goal is to extract only the main learning content, such as titles and substantial paragraphs from a book, and IGNORE extraneous elements like comprehension questions (e.g., "이 글의 주제는 무엇입니까?"), instructions, page numbers, or footnotes.

        Perform the following three tasks and provide the output in a single, valid JSON object that adheres to the provided schema.

        1.  **Extract Core Korean Text for Learning:** Transcribe ONLY the main learning content (titles and substantial paragraphs). Structure the output as an array of objects. Each object must have a 'type' (either 'title' or 'paragraph') and a 'content' (the text itself). Ensure 100% accuracy for the extracted text.
        2.  **Vocabulary Analysis:** For the extracted title and each sentence within the paragraphs, identify 3-5 key vocabulary words, phrases, or grammar points that are essential for a Japanese learner. The title should be treated as a sentence for this purpose. For each item, provide the original Korean, its Japanese translation/equivalent, and a brief, helpful explanation in JAPANESE.
        3.  **Japanese Translation:** Provide a complete and natural-sounding Japanese translation of the entire extracted Korean text. Crucially, structure this translation in the same way as the original Korean text: as an array of objects, where each object has a 'type' ('title' or 'paragraph') and 'content' (the translated text). The structure must mirror the original.

        The final output must be only the JSON object, with no other text or formatting.`,
    };

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [imagePart, textPart] },
            config: {
                responseMimeType: 'application/json',
                responseSchema: responseSchema,
            },
        });

        const jsonString = response.text.trim();
        const result = JSON.parse(jsonString);
        
        return result as AnalysisResult;

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to get a valid response from the Gemini API.");
    }
};

export const consolidateAnalyses = async (results: AnalysisResult[]): Promise<AnalysisResult> => {
    const model = 'gemini-2.5-flash';

    if (results.length === 0) {
        return {
            originalText: [],
            vocabularyAnalysis: [],
            japaneseTranslation: []
        };
    }
     if (results.length === 1) {
        return results[0];
    }

    const combinedKoreanText = results
        .flatMap(result => result.originalText.map(item => item.content))
        .join('\n\n');

    const textPart = {
        text: `You are an expert Korean language teacher for Japanese learners. Your task is to process the following Korean text, which has been combined from multiple sequential pages (indicated by larger gaps). Sentences are sometimes split across these page breaks.

        Your first and most important job is to intelligently merge the text into a single, coherent document, correctly rejoining any sentences that were split.

        After unifying the text, perform these three tasks and provide the output in a single, valid JSON object that adheres to the provided schema.

        1.  **Restructure Korean Text:** Present the corrected, unified Korean text. Structure this as an array of objects, each with a 'type' ('title' or 'paragraph') and 'content'. Identify a suitable overall title from the text.
        2.  **Vocabulary Analysis:** For the identified overall title and each sentence in the unified text, identify 3-5 key vocabulary words, phrases, or grammar points for a Japanese learner. Treat the title as a sentence for this analysis. For each item, provide the Korean, its Japanese translation, and a brief explanation in JAPANESE.
        3.  **Japanese Translation:** Provide a complete, natural Japanese translation of the entire unified Korean text. Structure this translation identically to the restructured Korean text (an array of 'type' and 'content' objects).

        Here is the combined text from the pages:
        ---
        ${combinedKoreanText}
        ---

        The final output must be only the JSON object, with no other text or formatting.`,
    };

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [textPart] },
            config: {
                responseMimeType: 'application/json',
                responseSchema: responseSchema,
            },
        });

        const jsonString = response.text.trim();
        const result = JSON.parse(jsonString);
        
        return result as AnalysisResult;

    } catch (error) {
        console.error("Error calling Gemini API for consolidation:", error);
        throw new Error("Failed to get a valid response from the Gemini API for consolidation.");
    }
};

export const generateSpeech = async (text: string, voice: 'female' | 'male'): Promise<string> => {
    const voiceName = voice === 'female' ? 'Puck' : 'Fenrir';
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
            throw new Error("No audio data returned from API.");
        }
        return base64Audio;
    } catch (error) {
        console.error("Error generating speech:", error);
        throw new Error("Failed to generate speech.");
    }
};

export const determinePageOrder = async (results: AnalysisResult[]): Promise<number[]> => {
    const model = 'gemini-2.5-flash';

    if (results.length <= 1) {
        return results.map((_, index) => index);
    }

    const pageContent = results.map((result, index) => {
        const text = result.originalText.map(item => item.content).join('\n');
        return `--- PAGE INDEX ${index} ---\n${text}`;
    }).join('\n\n');

    const textPart = {
        text: `You are an expert in document structuring and logical flow. You will be given text from multiple pages of a Korean book, each page identified by a unique index number. Your task is to determine the correct reading order based on the content's logical progression.

The content might include titles, main body paragraphs, and supplementary materials like exercises or further reading. The main content should come first, followed by supplementary materials.

Analyze the following pages and return a JSON object with a single key "order", which is an array of numbers representing the correct sequence of the original page indices. For example, if the correct order for three pages (indexed 0, 1, 2) is Page 1, then Page 2, then Page 0, you should return {"order": [1, 2, 0]}.

Here is the content from the pages:
---
${pageContent}
---

Return only the JSON object. The array must contain each original index exactly once.`,
    };

    const pageOrderSchema = {
        type: Type.OBJECT,
        properties: {
            order: {
                type: Type.ARRAY,
                description: 'An array of numbers representing the correct order of the original page indices. It must contain each index from 0 to N-1 exactly once.',
                items: {
                    type: Type.INTEGER
                }
            }
        },
        required: ['order']
    };

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [textPart] },
            config: {
                responseMimeType: 'application/json',
                responseSchema: pageOrderSchema,
            },
        });

        const jsonString = response.text.trim();
        const result = JSON.parse(jsonString);

        if (result.order && Array.isArray(result.order) && result.order.every(Number.isInteger)) {
            // Validate that the returned order is a valid permutation
            const originalIndices = new Set(results.map((_, i) => i));
            const returnedIndices = new Set(result.order);
            if (originalIndices.size === returnedIndices.size && [...originalIndices].every(i => returnedIndices.has(i))) {
                 return result.order;
            }
        }
        
        console.error("Invalid order format received from API:", result);
        throw new Error("Invalid order format received from API.");

    } catch (error) {
        console.error("Error calling Gemini API for page ordering:", error);
        throw new Error("Failed to get a valid response from the Gemini API for page ordering.");
    }
};