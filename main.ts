import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';

interface AddAliasPluginSettings {
	openaiApiKey: string;
}

const DEFAULT_SETTINGS: AddAliasPluginSettings = {
	openaiApiKey: '',
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
		
		// Получаем склонения с помощью OpenAI API
		const aliasesArray = await this.getDeclensions(title);
		
		if (aliasesArray && aliasesArray.length > 0) {
			await this.updateFrontMatter(activeFile, aliasesArray);
			new Notice('Алиасы обновлены');
		} else {
			new Notice('Не удалось получить алиасы');
		}
	}
	
	async getDeclensions(title: string): Promise<string[]> {
		const prompt = `Составь все возможные формы склонения для названия "${title}" и верни их в формате JSON массива строк или в виде одной строки, где формы разделены запятыми. Не добавляй никакой дополнительной информации. Пример: ["форма1", "форма2", "форма3"] или "форма1, форма2, форма3".`;
		
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.openaiApiKey}`,
				},
				body: JSON.stringify({
					model: 'gpt-3.5-turbo',
					messages: [
						{
							role: 'system',
							content: 'Вы опытный лингвист, который помогает создавать формы склонения слов. Возвращайте только запрошенные данные в нужном формате без дополнительного текста.',
						},
						{
							role: 'user',
							content: prompt,
						},
					],
					max_tokens: 200,
					temperature: 0,
				}),
			});
			
			const data = await response.json();
			
			if (response.ok) {
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
			} else {
				console.error('Ошибка OpenAI API:', data);
				return [];
			}
		} catch (error) {
			console.error('Ошибка при обращении к OpenAI API:', error);
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
	}
}
