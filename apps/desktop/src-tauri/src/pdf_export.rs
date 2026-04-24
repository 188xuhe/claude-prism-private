use printpdf::*;
use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};
use std::io::{BufWriter, Cursor, Write};

/// Export Markdown content to PDF bytes.
#[tauri::command]
pub async fn export_markdown_to_pdf(content: String) -> Result<Vec<u8>, String> {
    render_markdown_to_pdf(&content)
}

/// Render Markdown content to PDF.
fn render_markdown_to_pdf(content: &str) -> Result<Vec<u8>, String> {
    let (doc, page_idx, layer_idx) = PdfDocument::new(
        "ClaudePrism Markdown Export",
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );

    let page = doc.get_page(page_idx);
    let layer = page.get_layer(layer_idx);

    let parser = Parser::new(content);
    render_markdown_events(parser, &layer, &doc)?;

    let cursor = Cursor::new(Vec::new());
    let mut writer = BufWriter::new(cursor);
    doc.save(&mut writer).map_err(|e| format!("Failed to save PDF: {}", e))?;
    writer.flush().map_err(|e| format!("Failed to flush: {}", e))?;

    // Extract the inner buffer from the cursor
    let buffer = writer.into_inner().map_err(|e| format!("Failed to get buffer: {}", e))?.into_inner();
    Ok(buffer)
}

fn render_markdown_events<'a>(
    parser: Parser<'a>,
    layer: &PdfLayerReference,
    doc: &PdfDocumentReference,
) -> Result<(), String> {
    let mut current_y = Mm(280.0);
    let left_margin = Mm(20.0);
    let right_margin = Mm(190.0);
    let default_font_size = 12.0;
    let line_height = Mm(6.0);
    let mut indent = Mm(0.0);

    let font = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| e.to_string())?;
    let code_font = doc.add_builtin_font(BuiltinFont::Courier).map_err(|e| e.to_string())?;
    layer.set_fill_color(Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)));

    let mut pending_text = String::new();
    let mut current_font_size = default_font_size;
    let mut is_code_block = false;
    let mut is_inline_code = false;
    let mut in_list_item = false;
    let mut list_number: u64 = 0;

    for event in parser {
        match event {
            Event::Start(tag) => {
                match tag {
                    Tag::Heading { level, .. } => {
                        current_font_size = match level {
                            HeadingLevel::H1 => 24.0,
                            HeadingLevel::H2 => 20.0,
                            HeadingLevel::H3 => 16.0,
                            HeadingLevel::H4 => 14.0,
                            _ => 12.0,
                        };
                        current_y -= Mm(10.0);
                    }
                    Tag::Paragraph => {
                        // Skip paragraph inside code block
                        if !is_code_block {
                            current_y -= Mm(8.0);
                        }
                    }
                    Tag::BlockQuote(_) => {
                        indent += Mm(10.0);
                        current_y -= Mm(4.0);
                    }
                    Tag::List(Some(start)) => {
                        list_number = start;
                        indent += Mm(10.0);
                    }
                    Tag::List(None) => {
                        indent += Mm(10.0);
                    }
                    Tag::Item => {
                        in_list_item = true;
                        current_y -= Mm(3.0);
                    }
                    Tag::CodeBlock(_) => {
                        is_code_block = true;
                        current_y -= Mm(6.0);
                        indent += Mm(5.0);
                    }
                    Tag::Strong => {
                        // Note: printpdf doesn't support bold Helvetica, we'll increase size slightly
                        current_font_size += 1.0;
                    }
                    Tag::Emphasis => {
                        // Note: printpdf doesn't support italic Helvetica easily
                    }
                    Tag::Link { dest_url, .. } => {
                        pending_text.push_str(&format!(" [{}] ", dest_url));
                    }
                    _ => {}
                }
            }
            Event::End(tag_end) => {
                match tag_end {
                    TagEnd::Heading(_) => {
                        if !pending_text.is_empty() {
                            layer.use_text(pending_text.trim(), current_font_size, left_margin + indent, current_y, &font);
                            pending_text.clear();
                            current_y -= Mm(current_font_size * 0.3528 + 5.0);
                        }
                        current_font_size = default_font_size;
                    }
                    TagEnd::Paragraph => {
                        if !is_code_block && !pending_text.is_empty() {
                            render_wrapped_text(layer, &pending_text, current_font_size, left_margin + indent, right_margin - indent, current_y, line_height, &font);
                            pending_text.clear();
                            current_y -= Mm(6.0);
                        }
                    }
                    TagEnd::BlockQuote => {
                        indent -= Mm(10.0);
                        current_y -= Mm(4.0);
                    }
                    TagEnd::List(_) => {
                        indent -= Mm(10.0);
                    }
                    TagEnd::Item => {
                        if !pending_text.is_empty() {
                            let prefix = if list_number > 0 {
                                let num = list_number;
                                list_number += 1;
                                format!("{}. ", num)
                            } else {
                                "• ".to_string()
                            };
                            layer.use_text(&prefix, current_font_size, left_margin + indent - Mm(15.0), current_y, &font);
                            render_wrapped_text(layer, &pending_text, current_font_size, left_margin + indent, right_margin - indent, current_y, line_height, &font);
                            pending_text.clear();
                            current_y -= Mm(6.0);
                        }
                        in_list_item = false;
                    }
                    TagEnd::CodeBlock => {
                        if !pending_text.is_empty() {
                            // Render code block content line by line
                            for line in pending_text.lines() {
                                if current_y < Mm(20.0) {
                                    break;
                                }
                                layer.use_text(line, 10.0, left_margin + indent, current_y, &code_font);
                                current_y -= Mm(4.0);
                            }
                            pending_text.clear();
                        }
                        is_code_block = false;
                        indent -= Mm(5.0);
                        current_y -= Mm(6.0);
                    }
                    TagEnd::Strong => {
                        current_font_size -= 1.0;
                    }
                    TagEnd::Emphasis => {}
                    TagEnd::Link => {}
                    _ => {}
                }
            }
            Event::Text(text) => {
                pending_text.push_str(&text);
            }
            Event::SoftBreak | Event::HardBreak => {
                if is_code_block {
                    pending_text.push('\n');
                } else {
                    pending_text.push(' ');
                }
            }
            Event::Rule => {
                layer.set_line_dash_pattern(LineDashPattern::default());
                layer.set_outline_thickness(1.0);
                layer.set_outline_color(Color::Rgb(Rgb::new(0.8, 0.8, 0.8, None)));
                layer.add_line(Line {
                    points: vec![
                        (Point::new(left_margin, current_y), false),
                        (Point::new(right_margin, current_y), false),
                    ],
                    is_closed: false,
                });
                current_y -= Mm(8.0);
            }
            Event::Code(code) => {
                // Inline code - render with courier font
                pending_text.push_str(&code);
                is_inline_code = true;
            }
            _ => {}
        }

        if current_y < Mm(20.0) {
            break;
        }
    }

    // Handle any remaining pending text
    if !pending_text.is_empty() {
        if is_code_block {
            for line in pending_text.lines() {
                if current_y < Mm(20.0) {
                    break;
                }
                layer.use_text(line, 10.0, left_margin + indent, current_y, &code_font);
                current_y -= Mm(4.0);
            }
        } else {
            layer.use_text(pending_text.trim(), current_font_size, left_margin + indent, current_y, &font);
        }
    }

    Ok(())
}

fn render_wrapped_text(
    layer: &PdfLayerReference,
    text: &str,
    font_size: f32,
    left_x: Mm,
    right_x: Mm,
    mut current_y: Mm,
    line_height: Mm,
    font: &IndirectFontRef,
) {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut line_words = Vec::new();
    let mut line_width = Mm(0.0);
    let max_width = right_x - left_x;

    for word in words {
        let word_width = estimate_text_width(word, font_size);
        if line_width + word_width > max_width && !line_words.is_empty() {
            layer.use_text(line_words.join(" "), font_size, left_x, current_y, font);
            current_y -= line_height;
            line_words.clear();
            line_width = Mm(0.0);
        }
        line_words.push(word);
        line_width += word_width + Mm(3.0);
    }

    if !line_words.is_empty() {
        layer.use_text(line_words.join(" "), font_size, left_x, current_y, font);
    }
}

fn estimate_text_width(text: &str, font_size: f32) -> Mm {
    Mm(text.chars().count() as f32 * font_size * 0.5 * 0.3528)
}