Attribute VB_Name = "ImportarMovimentacoes"
Option Explicit

'==============================================================================
' IMPORTAR MOVIMENTACOES
' Le o arquivo movimentacoes_<banco>_<data>.xlsx (gerado no site, em
' Extratos -> Movimentacoes) e acrescenta os lancamentos na aba Movimentacoes
' da base EH (tabela tbl_Movimentacoes, uma linha por lancamento).
'
'   - Cada lancamento tem um ID. ID que ja esta na base e pulado, entao
'     importar o mesmo extrato de novo nao duplica nada, e correcoes feitas
'     a mao na base (codigo, valor, Obs) nao sao desfeitas.
'   - A coluna Cliente vem da aba Mapa da base: coluna A = nome no extrato
'     (o mesmo nome de aba que o Extratos -> Excel gerava), coluna B = cliente
'     (ex.: LuizFLM). Se o arquivo ja trouxer o Cliente preenchido (migracao
'     da base antiga), ele e mantido. Nome sem Mapa entra com Cliente vazio e aparece no
'     relatorio; depois de completar o Mapa, rode PreencherClientesPeloMapa.
'   - O alerta do site (coluna Alerta) vai para a coluna Obs como
'     "Conferir: ...". Filtre Obs por "Conferir" para ver so o que conferir.
'   - Se a aba Movimentacoes nao existir, a macro cria (com a tabela).
'
' Como usar: abra a base, deixe ela ativa e rode ImportarMovimentacoes
' (Alt+F8). Pode rodar de uma planilha de macros fora do OneDrive. Escolha um
' ou varios arquivos movimentacoes_...xlsx de uma vez. A base NAO e salva:
' confira e salve voce. O codigo nao usa acentos de proposito (os nomes com
' acento sao montados com ChrW).
'==============================================================================

Private Const TABELA As String = "tbl_Movimentacoes"
Private Const N_COLS As Long = 16
' Colunas da tabela na base (1 a 16)
Private Const C_DATA As Long = 1, C_DATALIQ As Long = 2, C_CLIENTE As Long = 3, C_NOME As Long = 4
Private Const C_BANCO As Long = 5, C_CODIGO As Long = 6, C_HIST As Long = 7, C_TIPO As Long = 8
Private Const C_VALOR As Long = 9, C_VALORLIQ As Long = 10, C_SALDO As Long = 11, C_DATAORIG As Long = 12
Private Const C_ARQUIVO As Long = 13, C_ID As Long = 14, C_IMPORTADO As Long = 15, C_OBS As Long = 16
' O arquivo do site tem as colunas 1 a 14 nessa mesma ordem

Private Function NomeAba() As String
    NomeAba = "Movimenta" & ChrW(231) & ChrW(245) & "es"   ' Movimentacoes com cedilha e til
End Function

Private Function Cabecalhos() As Variant
    Cabecalhos = Array("Data", "Data Liq.", "Cliente", "Nome no extrato", "Banco", _
        "C" & ChrW(243) & "digo", "Hist" & ChrW(243) & "rico", "Tipo", "Valor", _
        "Valor L" & ChrW(237) & "quido", "Saldo", "Data original", "Arquivo", "ID", _
        "Importado em", "Obs")
End Function

Public Sub ImportarMovimentacoes()
    Dim base As Workbook, lo As ListObject, mapa As Object, ids As Object
    Dim arquivos As Variant, k As Long, wbO As Workbook, wsO As Worksheet
    Dim dados As Variant, n As Long, i As Long, j As Long, id As String
    Dim novas() As Variant, nNovas As Long, nRepetidas As Long, nLidas As Long
    Dim semMapa As Object, nome As String, agora As Date, calcAntes As XlCalculation
    Dim relatorio As String, chave As Variant
    Dim temAlerta As Boolean, nConferir As Long

    Set base = ActiveWorkbook
    If Not TemAba(base, "Mapa") Then
        MsgBox "Deixe a base EH ativa antes de rodar a macro (ela precisa ter a aba Mapa: " & _
               "coluna A = nome no extrato, coluna B = cliente).", vbExclamation, "Importar movimentacoes"
        Exit Sub
    End If
    If base.ReadOnly Then
        MsgBox "A base '" & base.Name & "' esta aberta como SOMENTE LEITURA. Habilite a edicao e rode de novo.", vbCritical
        Exit Sub
    End If

    arquivos = Application.GetOpenFilename("Movimentacoes do site (*.xlsx),*.xlsx", , _
                                           "Escolha o(s) arquivo(s) movimentacoes_...xlsx", , True)
    If Not IsArray(arquivos) Then Exit Sub

    calcAntes = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Erro

    Set lo = GarantirTabela(base)
    Set mapa = LerMapa(base)
    Set ids = IdsExistentes(lo)
    Set semMapa = CreateObject("Scripting.Dictionary")
    agora = Now
    ReDim novas(1 To N_COLS, 1 To 1)   ' transposta no fim (Preserve so cresce a ultima dimensao)
    Dim capacidade As Long: capacidade = 1

    For k = LBound(arquivos) To UBound(arquivos)
        Set wbO = Workbooks.Open(arquivos(k), ReadOnly:=True, UpdateLinks:=False)
        Set wsO = Nothing
        On Error Resume Next
        Set wsO = wbO.Worksheets("Movimentacoes")
        On Error GoTo Erro
        If wsO Is Nothing Then Set wsO = wbO.Worksheets(1)
        If Trim(CStr(wsO.Cells(1, 1).Value)) <> "Data" Or Trim(CStr(wsO.Cells(1, 14).Value)) <> "ID" Then
            relatorio = relatorio & "- " & wbO.Name & ": nao parece um arquivo do Extratos -> Movimentacoes (ignorado)" & vbCrLf
            wbO.Close SaveChanges:=False
            GoTo Proximo
        End If
        n = wsO.Cells(wsO.Rows.Count, 14).End(xlUp).Row
        ' Coluna 16 = Alerta (versao com lista de alertas): vai para Obs na base
        temAlerta = (Trim(CStr(wsO.Cells(1, 16).Value)) = "Alerta")
        If n >= 2 Then
            dados = wsO.Range(wsO.Cells(2, 1), wsO.Cells(n, IIf(temAlerta, 16, 14))).Value
            If nNovas + n - 1 > capacidade Then
                capacidade = nNovas + n - 1
                ReDim Preserve novas(1 To N_COLS, 1 To capacidade)
            End If
            For i = 1 To n - 1
                id = Trim(CStr(dados(i, 14)))
                If id <> "" Then
                    nLidas = nLidas + 1
                    If ids.Exists(id) Then
                        nRepetidas = nRepetidas + 1
                    Else
                        ids.Add id, True
                        nNovas = nNovas + 1
                        For j = 1 To 14: novas(j, nNovas) = dados(i, j): Next j
                        nome = UCase(Trim(CStr(dados(i, C_NOME))))
                        novas(C_NOME, nNovas) = nome   ' Nome no extrato sempre em maiusculas
                        If Trim(CStr(dados(i, C_CLIENTE))) <> "" Then
                            ' Cliente ja veio preenchido no arquivo (ex.: migracao da base antiga): mantem
                            novas(C_CLIENTE, nNovas) = Trim(CStr(dados(i, C_CLIENTE)))
                        ElseIf mapa.Exists(nome) Then
                            novas(C_CLIENTE, nNovas) = mapa(nome)
                        Else
                            novas(C_CLIENTE, nNovas) = Empty
                            If Not semMapa.Exists(nome) Then semMapa.Add nome, CStr(dados(i, C_BANCO))
                        End If
                        novas(C_IMPORTADO, nNovas) = agora
                        novas(C_OBS, nNovas) = Empty
                        If temAlerta Then
                            If Trim(CStr(dados(i, 16))) <> "" Then
                                novas(C_OBS, nNovas) = "Conferir: " & Trim(CStr(dados(i, 16)))
                                nConferir = nConferir + 1
                            End If
                        End If
                    End If
                End If
            Next i
        End If
        wbO.Close SaveChanges:=False
Proximo:
    Next k

    If nNovas > 0 Then AcrescentarLinhas lo, novas, nNovas

    ' Linhas antigas ainda sem cliente: tenta de novo pelo Mapa
    Dim nPreenchidos As Long
    nPreenchidos = PreencherClientes(lo, mapa, semMapa)

    Application.Calculation = calcAntes
    Application.ScreenUpdating = True

    relatorio = "Lancamentos lidos: " & nLidas & vbCrLf & _
                "Novos na base: " & nNovas & vbCrLf & _
                "Ja estavam na base (pulados): " & nRepetidas & vbCrLf & _
                IIf(nConferir > 0, "Novos com alerta (Obs comeca com 'Conferir:'): " & nConferir & vbCrLf, "") & _
                IIf(nPreenchidos > 0, "Clientes preenchidos em linhas antigas: " & nPreenchidos & vbCrLf, "") & _
                relatorio
    If semMapa.Count > 0 Then
        relatorio = relatorio & vbCrLf & "Nomes SEM linha na aba Mapa (Cliente ficou vazio):" & vbCrLf
        For Each chave In semMapa.Keys
            relatorio = relatorio & "  - " & chave & " (" & semMapa(chave) & ")" & vbCrLf
        Next chave
        relatorio = relatorio & "Complete o Mapa e rode PreencherClientesPeloMapa." & vbCrLf
    End If
    MsgBox relatorio & vbCrLf & "A base nao foi salva: confira e salve.", vbInformation, "Importar movimentacoes"
    Exit Sub

Erro:
    Application.Calculation = calcAntes
    Application.ScreenUpdating = True
    MsgBox "Erro ao importar: " & Err.Description, vbCritical, "Importar movimentacoes"
End Sub

' Preenche a coluna Cliente das linhas que estao vazias, pela aba Mapa
Public Sub PreencherClientesPeloMapa()
    Dim base As Workbook, lo As ListObject, semMapa As Object, n As Long, chave As Variant, txt As String
    Set base = ActiveWorkbook
    If Not TemAba(base, "Mapa") Or Not TemAba(base, NomeAba()) Then
        MsgBox "Deixe a base EH ativa (abas Mapa e " & NomeAba() & ").", vbExclamation
        Exit Sub
    End If
    Set lo = GarantirTabela(base)
    Set semMapa = CreateObject("Scripting.Dictionary")
    n = PreencherClientes(lo, LerMapa(base), semMapa)
    txt = "Clientes preenchidos: " & n
    If semMapa.Count > 0 Then
        txt = txt & vbCrLf & vbCrLf & "Ainda sem linha no Mapa:" & vbCrLf
        For Each chave In semMapa.Keys: txt = txt & "  - " & chave & vbCrLf: Next chave
    End If
    MsgBox txt, vbInformation, "Preencher clientes"
End Sub

' Refaz a coluna "Nome no extrato" pelos arquivos que foram importados (casa pelo ID).
' Use se a coluna D for apagada ou colada por engano. Escolha todos os arquivos ja
' importados (ex.: a migracao e a v3). So a coluna D e alterada.
Public Sub RestaurarNomesNoExtrato()
    Dim base As Workbook, lo As ListObject, arquivos As Variant, k As Long, wbO As Workbook, wsO As Worksheet
    Dim nomes As Object, n As Long, i As Long, v As Variant, ids As Variant, col As Variant
    Dim nUsadas As Long, nTrocados As Long, nSemArquivo As Long, id As String, txt As String
    Set base = ActiveWorkbook
    If Not TemAba(base, NomeAba()) Then
        MsgBox "Deixe a base com a aba " & NomeAba() & " ativa antes de rodar.", vbExclamation
        Exit Sub
    End If
    arquivos = Application.GetOpenFilename("Movimentacoes (*.xlsx),*.xlsx", , _
                                           "Escolha TODOS os arquivos ja importados", , True)
    If Not IsArray(arquivos) Then Exit Sub
    Application.ScreenUpdating = False
    Set nomes = CreateObject("Scripting.Dictionary")
    For k = LBound(arquivos) To UBound(arquivos)
        Set wbO = Workbooks.Open(arquivos(k), ReadOnly:=True, UpdateLinks:=False)
        Set wsO = Nothing
        On Error Resume Next
        Set wsO = wbO.Worksheets("Movimentacoes")
        On Error GoTo 0
        If wsO Is Nothing Then Set wsO = wbO.Worksheets(1)
        If Trim(CStr(wsO.Cells(1, 14).Value)) = "ID" Then
            n = wsO.Cells(wsO.Rows.Count, 14).End(xlUp).Row
            If n >= 2 Then
                v = wsO.Range(wsO.Cells(2, 1), wsO.Cells(n, 14)).Value
                For i = 1 To n - 1
                    id = Trim(CStr(v(i, 14)))
                    If id <> "" Then nomes(id) = v(i, C_NOME)
                Next i
            End If
        Else
            txt = txt & "- " & wbO.Name & ": sem coluna ID (ignorado)" & vbCrLf
        End If
        wbO.Close SaveChanges:=False
    Next k
    Set lo = base.Worksheets(NomeAba()).ListObjects(TABELA)
    nUsadas = LinhasUsadas(lo)
    If nUsadas = 0 Then Application.ScreenUpdating = True: MsgBox "A tabela esta vazia.": Exit Sub
    ids = Coluna(lo, C_ID)
    col = Coluna(lo, C_NOME)
    For i = 1 To nUsadas
        id = Trim(CStr(ids(i, 1)))
        If nomes.Exists(id) Then
            If CStr(col(i, 1)) <> CStr(nomes(id)) Then col(i, 1) = nomes(id): nTrocados = nTrocados + 1
        Else
            nSemArquivo = nSemArquivo + 1
        End If
    Next i
    lo.ListColumns(C_NOME).DataBodyRange.Value = col
    Application.ScreenUpdating = True
    MsgBox "Nomes corrigidos: " & nTrocados & vbCrLf & _
           "Linhas sem o ID nos arquivos escolhidos (ficaram como estavam): " & nSemArquivo & vbCrLf & txt & vbCrLf & _
           "A base nao foi salva: confira e salve.", vbInformation, "Restaurar Nome no extrato"
End Sub

'------------------------------------------------------------------------------

Private Function GarantirTabela(base As Workbook) As ListObject
    Dim ws As Worksheet, cab As Variant, j As Long
    If TemAba(base, NomeAba()) Then
        Set ws = base.Worksheets(NomeAba())
    Else
        Set ws = base.Worksheets.Add(After:=base.Worksheets(base.Worksheets.Count))
        ws.Name = NomeAba()
    End If
    On Error Resume Next
    Set GarantirTabela = ws.ListObjects(TABELA)
    On Error GoTo 0
    If Not GarantirTabela Is Nothing Then Exit Function

    cab = Cabecalhos()
    For j = 0 To N_COLS - 1: ws.Cells(1, j + 1).Value = cab(j): Next j
    Set GarantirTabela = ws.ListObjects.Add(xlSrcRange, ws.Range(ws.Cells(1, 1), ws.Cells(2, N_COLS)), , xlYes)
    GarantirTabela.Name = TABELA
    GarantirTabela.TableStyle = "TableStyleLight1"
    ws.Columns(C_DATA).NumberFormat = "dd/mm/yyyy"
    ws.Columns(C_DATALIQ).NumberFormat = "dd/mm/yyyy"
    ws.Columns(C_DATAORIG).NumberFormat = "dd/mm/yyyy"
    ws.Columns(C_IMPORTADO).NumberFormat = "dd/mm/yyyy hh:mm"
    ws.Range(ws.Columns(C_VALOR), ws.Columns(C_SALDO)).NumberFormat = "#,##0.00;[Red]-#,##0.00"
    ws.Cells(1, 1).ColumnWidth = 11: ws.Cells(1, 2).ColumnWidth = 11: ws.Cells(1, 3).ColumnWidth = 14
    ws.Cells(1, 4).ColumnWidth = 32: ws.Cells(1, 6).ColumnWidth = 20: ws.Cells(1, 7).ColumnWidth = 48
    ws.Cells(1, 8).ColumnWidth = 16: ws.Cells(1, 9).ColumnWidth = 14: ws.Cells(1, 10).ColumnWidth = 14
    ws.Cells(1, 11).ColumnWidth = 14: ws.Cells(1, 13).ColumnWidth = 28: ws.Cells(1, 14).ColumnWidth = 16
    ws.Cells(1, 16).ColumnWidth = 30
End Function

' Primeira linha livre da tabela (uma tabela nova tem 1 linha de dados vazia)
Private Function LinhasUsadas(lo As ListObject) As Long
    If lo.DataBodyRange Is Nothing Then Exit Function
    LinhasUsadas = lo.ListRows.Count
    If LinhasUsadas = 1 Then
        If Application.WorksheetFunction.CountA(lo.DataBodyRange) = 0 Then LinhasUsadas = 0
    End If
End Function

Private Sub AcrescentarLinhas(lo As ListObject, novas As Variant, nNovas As Long)
    Dim usadas As Long, primeira As Long, saida() As Variant, i As Long, j As Long
    usadas = LinhasUsadas(lo)
    primeira = lo.HeaderRowRange.Row + 1 + usadas
    ReDim saida(1 To nNovas, 1 To N_COLS)
    For i = 1 To nNovas
        For j = 1 To N_COLS: saida(i, j) = novas(j, i): Next j
    Next i
    lo.Resize lo.Range.Resize(1 + usadas + nNovas)
    lo.Parent.Cells(primeira, 1).Resize(nNovas, N_COLS).Value = saida
End Sub

Private Function LerMapa(base As Workbook) As Object
    Dim ws As Worksheet, ult As Long, i As Long, a As String, b As String
    Set LerMapa = CreateObject("Scripting.Dictionary")
    Set ws = base.Worksheets("Mapa")
    ult = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    For i = 2 To ult
        a = UCase(Trim(CStr(ws.Cells(i, 1).Value)))
        b = Trim(CStr(ws.Cells(i, 2).Value))
        If a <> "" And b <> "" Then
            If Not LerMapa.Exists(a) Then LerMapa.Add a, b
        End If
    Next i
End Function

Private Function IdsExistentes(lo As ListObject) As Object
    Dim v As Variant, i As Long, n As Long, d As Object
    Set d = CreateObject("Scripting.Dictionary")
    Set IdsExistentes = d
    n = LinhasUsadas(lo)
    If n = 0 Then Exit Function
    v = Coluna(lo, C_ID)
    For i = 1 To n
        If Trim(CStr(v(i, 1))) <> "" Then d(Trim(CStr(v(i, 1)))) = True
    Next i
End Function

Private Function PreencherClientes(lo As ListObject, mapa As Object, semMapa As Object) As Long
    Dim n As Long, cli As Variant, nomes As Variant, bancos As Variant, i As Long, nome As String, mudou As Boolean
    n = LinhasUsadas(lo)
    If n = 0 Then Exit Function
    cli = Coluna(lo, C_CLIENTE)
    nomes = Coluna(lo, C_NOME)
    bancos = Coluna(lo, C_BANCO)
    For i = 1 To n
        If Trim(CStr(cli(i, 1))) = "" Then
            nome = UCase(Trim(CStr(nomes(i, 1))))
            If mapa.Exists(nome) Then
                cli(i, 1) = mapa(nome): mudou = True
                PreencherClientes = PreencherClientes + 1
                If semMapa.Exists(nome) Then semMapa.Remove nome
            ElseIf nome <> "" And Not semMapa.Exists(nome) Then
                semMapa.Add nome, CStr(bancos(i, 1))
            End If
        End If
    Next i
    If mudou Then lo.ListColumns(C_CLIENTE).DataBodyRange.Value = cli
End Function

' Coluna da tabela como matriz (n, 1), mesmo quando so tem uma linha
Private Function Coluna(lo As ListObject, c As Long) As Variant
    Dim r As Range, v() As Variant
    Set r = lo.ListColumns(c).DataBodyRange
    If r.Cells.Count = 1 Then
        ReDim v(1 To 1, 1 To 1): v(1, 1) = r.Value: Coluna = v
    Else
        Coluna = r.Value
    End If
End Function

Private Function TemAba(wb As Workbook, nome As String) As Boolean
    Dim ws As Worksheet
    For Each ws In wb.Worksheets
        If StrComp(ws.Name, nome, vbTextCompare) = 0 Then TemAba = True: Exit Function
    Next ws
End Function
