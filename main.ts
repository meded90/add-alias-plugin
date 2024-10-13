import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';

interface AddAliasPluginSettings {
	openaiApiKey: string;
	maxContentLength: number;
}

const DEFAULT_SETTINGS: AddAliasPluginSettings = {
	openaiApiKey: '',
	maxContentLength: 2000, // Максимальное количество символов содержимого
};

export default class AddAliasPlugin extends Plugin {
	settings: AddAliasPluginSettings;
	
	async onload() {
		await this.loadSettings();
		
		this.addCommand({
			id: 'add-aliases-with-openai',
			name: 'Добавить алиасы с OpenAI',
			callback: () => this.addAliases(),
		});
		
		this.addSettingTab(new AddAliasSettingTab(this.app, this));
	}
	
	async addAliases() {
		const activeFile = this.app.workspace.getActiveFile();
		
		if (!activeFile) {
			new Notice('Нет открытого файла');
			return;
		}
		
		const title = activeFile.basename;
		
		// Проверяем, установлен ли API-ключ
		if (!this.settings.openaiApiKey) {
			new Notice('Пожалуйста, введите ваш OpenAI API ключ в настройках плагина');
			return;
		}
		
		// Получаем содержимое файла
		let fileContent = await this.app.vault.read(activeFile);
		
		// Удаляем YAML метаданные из содержимого
		fileContent = fileContent.replace(/^---\n[\s\S]*?\n---\n/, '');
		
		// Ограничиваем длину содержимого
		const maxContentLength = this.settings.maxContentLength;
		if (fileContent.length > maxContentLength) {
			fileContent = fileContent.substring(0, maxContentLength);
		}
		
		// Получаем алиасы с помощью OpenAI API, передавая название и содержимое
		const aliasesArray = await this.getAliases(title, fileContent);
		
		if (aliasesArray && aliasesArray.length > 0) {
			await this.updateFrontMatter(activeFile, aliasesArray);
			new Notice('Алиасы обновлены');
		} else {
			new Notice('Не удалось получить алиасы');
		}
	}
	
	async getAliases(title: string, content: string): Promise<string[]> {
		// Новый промпт, включающий название и содержимое файла
		const prompt = `На основе следующего текста заметки предложи возможные алиасы основанные на 1) синонимах и склонения и альтернативные названия Заголовок заметки 2) другие термины описанные в данной заметки 3) названия на английском языке. Возвращай ответ в формате JSON массива строк или в виде одной строки, где алиасы разделены запятыми. Не добавляй никакой дополнительной информации.

Заголовок заметки: "${title}"

Содержимое заметки:
${content}

Пример ответа: ["алиас1", "алиас2", "алиас3"] или "алиас1, алиас2, алиас3".`;
		
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.openaiApiKey}`,
				},
				body: JSON.stringify({
					model: 'gpt-4o-mini',
					messages: [
						{
							role: 'system',
							content: 'Вы опытный лингвист и эксперт по семантике, который помогает создавать релевантные алиасы для заметок. Возвращайте только запрошенные данные в нужном формате JSON без дополнительного текста.',
						},
						{
							role: 'user',
							content: prompt,
						},
					],
					max_tokens: 200,
					temperature: 0.7, // Повышаем температуру для большей вариативности
				}),
			});
			
			if (!response.ok) {
				const errorData = await response.json();
				console.error('Ошибка OpenAI API:', errorData);
				new Notice(`Ошибка OpenAI API: ${errorData.error.message}`);
				return [];
			}
			
			const data = await response.json();
			let content = data.choices[0].message.content.trim();
			
			let aliasesArray: string[] = [];
			
			// Попробуем распарсить как JSON
			try {
				aliasesArray = JSON.parse(content);
			} catch (e) {
				// Если не получилось, попробуем разделить строку по запятым
				aliasesArray = content.split(',').map((s: string) => s.trim());
			}
			
			return aliasesArray;
		} catch (error) {
			console.error('Ошибка при обращении к OpenAI API:', error);
			new Notice('Ошибка при обращении к OpenAI API. Проверьте подключение к интернету.');
			return [];
		}
	}
	
	async updateFrontMatter(file: TFile, aliasesArray: string[]) {
		const fileCache = this.app.metadataCache.getFileCache(file);
		let existingAliases: string[] = [];
		
		// Получаем существующие алиасы из метаданных
		if (fileCache && fileCache.frontmatter) {
			const fmAliases = fileCache.frontmatter.aliases;
			if (fmAliases) {
				if (Array.isArray(fmAliases)) {
					existingAliases = fmAliases;
				} else if (typeof fmAliases === 'string') {
					existingAliases = [fmAliases];
				}
			}
		}
		
		// Объединяем и удаляем дубликаты
		const combinedAliases = Array.from(new Set([...existingAliases, ...aliasesArray]));
		
		// Обновляем метаданные
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.aliases = combinedAliases;
		});
	}
	
	onunload() {
		console.log('Плагин AddAliasPlugin выгружен');
	}
	
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class AddAliasSettingTab extends PluginSettingTab {
	plugin: AddAliasPlugin;
	
	constructor(app: App, plugin: AddAliasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	
	display(): void {
		const { containerEl } = this;
		
		containerEl.empty();
		
		containerEl.createEl('h2', { text: 'Настройки плагина AddAliasPlugin' });
		
		new Setting(containerEl)
			.setName('OpenAI API ключ')
			.setDesc('Введите ваш OpenAI API ключ')
			.addText((text) =>
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					})
			);
		
		new Setting(containerEl)
			.setName('Максимальная длина содержимого')
			.setDesc('Максимальное количество символов содержимого заметки, передаваемого в OpenAI API')
			.addText((text) =>
				text
					.setPlaceholder('2000')
					.setValue(this.plugin.settings.maxContentLength.toString())
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxContentLength = num;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
