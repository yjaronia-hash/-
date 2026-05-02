export interface Keyword {
    korean: string;
    japanese: string;
    explanation: string;
}

export interface VocabularyItem {
    sentence: string;
    keywords: Keyword[];
}

export interface FormattedTextItem {
    type: 'title' | 'paragraph';
    content: string;
}

export interface AnalysisResult {
    originalText: FormattedTextItem[];
    vocabularyAnalysis: VocabularyItem[];
    japaneseTranslation: FormattedTextItem[];
}
