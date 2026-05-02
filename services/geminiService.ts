import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { AnalysisResult } from '../types';

// Initialize GoogleGenAI with API_KEY from environment variables.
// Supports both Vite define (process.env) and standard Vite env (import.meta.env)
const apiKey = process.env.GEMINI_API_KEY || 
               process.env.API_KEY || 
               import.meta.env.VITE_GEMINI_API_KEY || 
               '';

const ai = new GoogleGenAI({ apiKey });

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        originalText: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: ['title', 'paragraph'] },
                    content: { type: Type.STRING }
                },
                required: ['type', 'content']
            }
        },
        japaneseTranslation: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    type: { type: Type.STRING, enum: ['title', 'paragraph'] },
                    content: { type: Type.STRING }
                },
                required: ['type', 'content']
            }
        },
        vocabularyAnalysis: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    sentence: { type: Type.STRING },
                    keywords: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                korean: { type: Type.STRING },
                                japanese: { type: Type.STRING },
                                explanation: { type: Type.STRING }
                            },
                            required: ['korean', 'japanese', 'explanation']
                        }
                    }
                },
                required: ['sentence', 'keywords']
            }
        }
    },
    required: ['originalText', 'japaneseTranslation', 'vocabularyAnalysis']
};

const cleanJsonString = (str: string): string => {
    // Remove markdown code blocks if present
    return str.replace(/```json\n?|```/g, '').trim();
};

export const analyzeKoreanImage = async (base64ImageData: string, mimeType: string): Promise<AnalysisResult> => {
    const model = 'gemini-3-flash-preview';

    const imagePart = {
        inlineData: {
            mimeType: mimeType,
            data: base64ImageData
        }
    };

    const prompt = `
        이 한국어 이미지를 분석하여 일본인 한국어 학습자를 위한 학습 자료를 만들어주세요.
        이미지에 제목이나 본문이 아닌 부차적인 요소(예: 연습 문제, 쪽번호)는 제외하고 본연의 학습 텍스트만 추출하세요.
        다음 정보를 포함해야 합니다:
        1. 이미지에서 추출한 한국어 원문 (제목과 본문 구분)
        2. 자연스러운 일본어 번역 (원문과 동일한 구조)
        3. 주요 문장별 핵심 어휘 및 표현 분석 (단어, 의미, 일본어 설명)

        반드시 지정된 JSON 스키마 형식에 맞춰 응답해 주세요.
    `;

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: { parts: [imagePart, { text: prompt }] },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            }
        });

        const text = cleanJsonString(response.text || '');
        if (!text) throw new Error("Empty response from Gemini API.");
        
        return JSON.parse(text) as AnalysisResult;
    } catch (e) {
        console.error("Gemini Analysis Error:", e);
        throw new Error(e instanceof Error ? e.message : "Failed to get a valid response from the Gemini API.");
    }
};

export const consolidateAnalyses = async (results: AnalysisResult[]): Promise<AnalysisResult> => {
    const model = 'gemini-3-flash-preview';

    if (results.length === 0) {
        return {
            originalText: [],
            japaneseTranslation: [],
            vocabularyAnalysis: []
        };
    }

    if (results.length === 1) return results[0];

    const prompt = `
        다음은 여러 페이지로 구성된 한국어 학습 자료의 분석 결과들입니다. 
        이 내용들을 하나의 일관된 학습 자료로 통합해 주세요.
        페이지가 넘어가며 끊긴 문장을 자연스럽게 잇고, 중복된 내용은 정리하세요.
        
        분석 결과 데이터:
        ${JSON.stringify(results)}

        반드시 지정된 JSON 스키마 형식에 맞춰 한 개의 통합된 AnalysisResult 객체로 응답해 주세요.
    `;

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            }
        });

        const text = cleanJsonString(response.text || '');
        if (!text) throw new Error("Empty response from Gemini API.");
        return JSON.parse(text) as AnalysisResult;
    } catch (e) {
        console.error("Gemini Consolidation Error:", e);
        throw new Error(e instanceof Error ? e.message : "Failed to consolidate analysis results.");
    }
};

export const generateSpeech = async (text: string, voice: 'female' | 'male'): Promise<string> => {
    const voiceName = voice === 'female' ? 'Kore' : 'Fenrir';
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
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
        if (base64Audio) {
            return base64Audio;
        } else {
            throw new Error("Audio data not found in response.");
        }
    } catch (e) {
        console.error("TTS Generation Error:", e);
        throw new Error("음성 생성에 실패했습니다.");
    }
};

export const determinePageOrder = async (results: AnalysisResult[]): Promise<number[]> => {
    const model = 'gemini-3-flash-preview';

    if (results.length <= 1) {
        return results.map((_, index) => index);
    }

    const simplifiedResults = results.map((r, i) => ({
        index: i,
        snippet: r.originalText.slice(0, 3).map(t => t.content).join(' ')
    }));

    const prompt = `
        다음은 이미지에서 추출된 여러 페이지의 한국어 텍스트 스니펫들입니다.
        내용의 흐름상 가장 적절한 페이지 순서를 결정해 주세요.
        응답은 반드시 {"order": [0, 2, 1, ...]} 형태의 JSON으로만 하세요.

        데이터:
        ${JSON.stringify(simplifiedResults)}
    `;

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        order: {
                            type: Type.ARRAY,
                            items: { type: Type.INTEGER }
                        }
                    },
                    required: ['order']
                }
            }
        });

        const text = cleanJsonString(response.text || '');
        if (!text) return results.map((_, index) => index);
        
        const data = JSON.parse(text);
        if (data && Array.isArray(data.order)) {
            return data.order;
        }
        return results.map((_, index) => index);
    } catch (e) {
        console.error("Page Ordering Error:", e);
        return results.map((_, index) => index);
    }
};
